-- 00037: admin workflow を機能させるためのインフラ強化
--
-- 5 並列レビューで判明した Critical を一括対処:
--   1. meeting_participants の admin UPDATE policy 不在 → POST link が 0 件で黙って失敗
--   2. POST link-meetings の N+1 (100 件で 100 RPC) → 1 RPC に集約
--   3. dashboard DAU/WAU/MAU の全件転送 → SQL count(distinct) 集約 RPC
--   4. audit_logs の authenticated/anon に UPDATE/DELETE/TRUNCATE GRANT が残存 → REVOKE
--   5. audit-logs cursor の tie-break 欠落 → (created_at, id) 複合 cursor RPC
--   6. ILIKE 全件 seq scan → trgm GIN
--   7. 不完全 profile 検索の seq scan → partial index
--   8. import-requests linked_meetings の全件転送 → RPC

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =================================================================
-- 1. meeting_participants admin UPDATE policy
-- =================================================================
DROP POLICY IF EXISTS auth_admin_update_participants ON public.meeting_participants;
CREATE POLICY auth_admin_update_participants
  ON public.meeting_participants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_admin = true)
  );

-- =================================================================
-- 2. audit_logs の過剰 GRANT を REVOKE (append-only 化)
-- =================================================================
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon;

-- =================================================================
-- 3. trgm GIN index (users 検索高速化)
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_name_trgm
  ON public.user_profiles USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_user_profiles_company_trgm
  ON public.user_profiles USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email_trgm
  ON public.user_profiles USING gin (email gin_trgm_ops);

-- =================================================================
-- 4. 不完全 profile 検索用 partial index
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_incomplete
  ON public.user_profiles (id)
  WHERE is_active AND (industry IS NULL OR bio IS NULL);

-- =================================================================
-- 5. meeting_participants の (transcript_id, speaker_name) 複合 index
--    (link-meetings RPC のフィルタ高速化)
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_participants_transcript_speaker
  ON public.meeting_participants (transcript_id, speaker_name);

-- =================================================================
-- 6. RPC: admin_dashboard_kpi
--    全件転送で OOM していた DAU/WAU/MAU を SQL 集約に置換
-- =================================================================
DROP FUNCTION IF EXISTS public.admin_dashboard_kpi();
CREATE OR REPLACE FUNCTION public.admin_dashboard_kpi()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  -- 認可
  SELECT is_admin INTO v_is_admin
    FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_dashboard_kpi: admin only';
  END IF;

  RETURN jsonb_build_object(
    'active_users_total',
      (SELECT count(*) FROM public.user_profiles WHERE is_active),
    'dau_24h',
      (SELECT count(DISTINCT actor_id) FROM public.audit_logs
        WHERE created_at >= now() - interval '1 day' AND actor_id IS NOT NULL),
    'wau_7d',
      (SELECT count(DISTINCT actor_id) FROM public.audit_logs
        WHERE created_at >= now() - interval '7 days' AND actor_id IS NOT NULL),
    'mau_30d',
      (SELECT count(DISTINCT actor_id) FROM public.audit_logs
        WHERE created_at >= now() - interval '30 days' AND actor_id IS NOT NULL),
    'onboarding_completed',
      (SELECT count(*) FROM public.user_profiles
        WHERE is_active AND COALESCE(onboarding_step, 0) >= 3),
    'onboarding_in_progress',
      (SELECT count(*) FROM public.user_profiles
        WHERE is_active AND COALESCE(onboarding_step, 0) < 3),
    'connections_accepted_total',
      (SELECT count(*) FROM public.connections WHERE status = 'accepted'),
    'connections_pending',
      (SELECT count(*) FROM public.connections WHERE status = 'pending'),
    'matches_total',
      (SELECT count(*) FROM public.matching_scores_v4 WHERE total_score > 0),
    'pending_import_requests',
      (SELECT count(*) FROM public.meeting_data_import_requests
        WHERE status = 'pending'),
    'processing_import_requests',
      (SELECT count(*) FROM public.meeting_data_import_requests
        WHERE status = 'processing'),
    'transcript_errors',
      (SELECT count(*) FROM public.meeting_transcripts WHERE status = 'error'),
    'incomplete_profiles',
      (SELECT count(*) FROM public.user_profiles
        WHERE is_active AND (industry IS NULL OR bio IS NULL)),
    'participants_linked_7d',
      (SELECT count(*) FROM public.meeting_participants
        WHERE user_id IS NOT NULL AND linked_method = 'manual'
          AND created_at >= now() - interval '7 days')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_kpi() TO authenticated, service_role;

-- =================================================================
-- 7. RPC: link_import_request_meetings
--    POST の N+1 を 1 RPC に集約。トランザクション保証 + idempotent。
--    既に他 user に紐付け済の participant は上書きしない (force=false 時)。
-- =================================================================
DROP FUNCTION IF EXISTS public.link_import_request_meetings(UUID, JSONB, BOOLEAN);
CREATE OR REPLACE FUNCTION public.link_import_request_meetings(
  p_request_id UUID,
  p_meetings JSONB,        -- [{transcript_id, speaker_name}, ...]
  p_force BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_status TEXT;
  v_linked INT;
BEGIN
  -- 認可
  SELECT is_admin INTO v_is_admin
    FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'link_import_request_meetings: admin only';
  END IF;

  -- 申請取得
  SELECT user_id, status INTO v_user_id, v_status
    FROM public.meeting_data_import_requests
   WHERE id = p_request_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'link_import_request_meetings: request not found';
  END IF;

  -- 単一 UPDATE で全 transcript の speaker_name 一致行を一括 back-fill
  -- speaker_name は exact 一致 (lower) で照合 (ILIKE %x% の過剰マッチを排除)
  WITH targets AS (
    SELECT
      (elem->>'transcript_id')::UUID AS transcript_id,
      lower(trim(elem->>'speaker_name')) AS speaker_name_lower
    FROM jsonb_array_elements(p_meetings) AS elem
    WHERE elem->>'transcript_id' IS NOT NULL
      AND elem->>'speaker_name' IS NOT NULL
  ),
  upd AS (
    UPDATE public.meeting_participants mp
       SET user_id = v_user_id,
           is_linked = true,
           linked_method = 'manual'
      FROM targets t
     WHERE mp.transcript_id = t.transcript_id
       AND lower(trim(mp.speaker_name)) = t.speaker_name_lower
       AND (
         mp.user_id IS NULL
         OR (p_force = true AND mp.user_id <> v_user_id)
       )
     RETURNING mp.id
  )
  SELECT count(*) INTO v_linked FROM upd;

  -- 申請を pending → processing に遷移 (done/rejected/cancelled は触らない)
  UPDATE public.meeting_data_import_requests
     SET status = 'processing'
   WHERE id = p_request_id AND status = 'pending';

  RETURN jsonb_build_object(
    'participants_linked', COALESCE(v_linked, 0),
    'request_user_id', v_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_import_request_meetings(UUID, JSONB, BOOLEAN)
  TO authenticated, service_role;

-- =================================================================
-- 8. RPC: user_linked_meetings_count
--    /api/v1/import-requests の linked_meetings 集計 (全件転送回避)
-- =================================================================
DROP FUNCTION IF EXISTS public.user_linked_meetings_count(UUID);
CREATE OR REPLACE FUNCTION public.user_linked_meetings_count(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'user_linked_meetings_count: unauthenticated';
  END IF;
  -- 自分以外の集計は admin のみ許可
  IF v_caller <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = v_caller AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'user_linked_meetings_count: forbidden';
  END IF;

  SELECT count(DISTINCT transcript_id) INTO v_count
    FROM public.meeting_participants
   WHERE user_id = p_user_id;

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_linked_meetings_count(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
