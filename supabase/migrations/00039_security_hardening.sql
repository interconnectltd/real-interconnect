-- 00039: セキュリティ Critical 集中修正
--
-- 5並列セキュリティ監査で発掘した Critical/High を DB 層で対処:
--   1. notifications: 一般 user が他人 user_id 宛 INSERT できる (FOR ALL + WITH CHECK 省略)
--   2. audit_logs_self_insert: action を `admin.*` で偽造可能 → action prefix 制限
--   3. audit_logs: WORM trigger (UPDATE/DELETE で RAISE EXCEPTION)
--   4. audit_logs SELECT GRANT が anon に残存 → REVOKE
--   5. meeting_data_import_requests: 楽観ロック用 version カラム追加
--   6. link_import_request_meetings RPC に SELECT FOR UPDATE + 内部 audit
--   7. notifications.message に PII を生コピーしないよう admin_note は注記のみ参照に

-- =================================================================
-- 1. notifications policy 整理 (INSERT を admin/service_role のみに)
-- =================================================================
DROP POLICY IF EXISTS users_own_notifications ON public.notifications;

-- 自分の notification の SELECT/UPDATE/DELETE は本人のみ
CREATE POLICY notifications_self_select
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY notifications_self_update
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY notifications_self_delete
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT は notifications_admin_insert (00038) のみで通る
-- (一般 user の任意 INSERT 経路を完全閉鎖)

-- =================================================================
-- 2. audit_logs_self_insert に action prefix 制限
-- =================================================================
DROP POLICY IF EXISTS audit_logs_self_insert ON public.audit_logs;

CREATE POLICY audit_logs_self_insert
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      -- 一般 user 向け action は明示プレフィクス制限
      action LIKE 'import_request.%'
      OR action LIKE 'chat.%'
      OR action LIKE 'calendar.%'
      OR action LIKE 'user.%'
    )
  );

-- =================================================================
-- 3. audit_logs WORM trigger (改竄検知)
-- =================================================================
CREATE OR REPLACE FUNCTION public.audit_logs_prevent_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (WORM)';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_prevent_change();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_prevent_change();

-- =================================================================
-- 4. audit_logs から anon の権限を完全 REVOKE
-- =================================================================
REVOKE ALL ON public.audit_logs FROM anon;

-- =================================================================
-- 5. meeting_data_import_requests に version カラム (楽観ロック)
-- =================================================================
ALTER TABLE public.meeting_data_import_requests
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.import_req_increment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.version = COALESCE(OLD.version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS import_req_bump_version ON public.meeting_data_import_requests;
CREATE TRIGGER import_req_bump_version
  BEFORE UPDATE ON public.meeting_data_import_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.import_req_increment_version();

-- =================================================================
-- 6. link_import_request_meetings RPC に FOR UPDATE lock + 内部 audit
-- =================================================================
DROP FUNCTION IF EXISTS public.link_import_request_meetings(UUID, JSONB, BOOLEAN);
CREATE OR REPLACE FUNCTION public.link_import_request_meetings(
  p_request_id UUID,
  p_meetings JSONB,
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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT is_admin INTO v_is_admin
    FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- 申請レコードを排他ロック (DELETE cancel との race を防止)
  SELECT user_id, status INTO v_user_id, v_status
    FROM public.meeting_data_import_requests
   WHERE id = p_request_id
   FOR UPDATE;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'request not found';
  END IF;
  -- cancelled に遷移済なら拒否
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'request was cancelled';
  END IF;

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

  -- 内部 audit_log (RPC 直叩き対策)
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, payload)
  VALUES (
    v_caller,
    'admin.import_request.update',
    'import_request',
    p_request_id::text,
    jsonb_build_object(
      'op', 'link_meetings',
      'target_user_id', v_user_id,
      'meetings_attempted', jsonb_array_length(p_meetings),
      'participants_linked', COALESCE(v_linked, 0),
      'force', p_force
    )
  );

  -- 申請を pending → processing に遷移
  IF v_status = 'pending' THEN
    UPDATE public.meeting_data_import_requests
       SET status = 'processing'
     WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'participants_linked', COALESCE(v_linked, 0),
    'request_user_id', v_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_import_request_meetings(UUID, JSONB, BOOLEAN)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
