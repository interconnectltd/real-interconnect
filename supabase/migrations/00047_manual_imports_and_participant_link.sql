-- 00047: 会議紐付けの「participant 直接指定」と「対面/手動貼り付け」両対応
--
-- 1) link_import_request_meetings_v2 RPC
--    旧 v1 は speaker_name 一致で UPDATE していたが、表記揺れ・同名 spoofing
--    のリスクがあった。新 RPC は participant_id 直接指定 → 透明性最大。
--    旧 v1 は後方互換で残置。
--
-- 2) meeting_manual_imports テーブル
--    対面会議や tl;dv 録画なしのケース用に、文字起こし/要約を直接貼り付けで
--    取り込む。後で AI 抽出で meeting_transcripts へ昇格できるよう
--    processed_to_transcript_id FK を持つ。

-- ────────────────────────────────────────────────────────────
-- 1) link_import_request_meetings_v2 RPC
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.link_import_request_meetings_v2(UUID, UUID[], BOOLEAN);
CREATE OR REPLACE FUNCTION public.link_import_request_meetings_v2(
  p_request_id UUID,
  p_participant_ids UUID[],
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
  v_linked INT;
BEGIN
  -- 認可
  SELECT is_admin INTO v_is_admin
    FROM public.user_profiles WHERE id = v_caller;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'link_import_request_meetings_v2: admin only';
  END IF;

  -- 申請取得
  SELECT user_id INTO v_user_id
    FROM public.meeting_data_import_requests
   WHERE id = p_request_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'link_import_request_meetings_v2: request not found';
  END IF;

  -- participant_id 直接指定で UPDATE
  WITH upd AS (
    UPDATE public.meeting_participants mp
       SET user_id = v_user_id,
           is_linked = true,
           linked_method = 'manual'
     WHERE mp.id = ANY(p_participant_ids)
       AND (
         mp.user_id IS NULL
         OR (p_force = true AND mp.user_id <> v_user_id)
       )
    RETURNING mp.id
  )
  SELECT count(*) INTO v_linked FROM upd;

  -- pending → processing
  UPDATE public.meeting_data_import_requests
     SET status = 'processing'
   WHERE id = p_request_id AND status = 'pending';

  RETURN jsonb_build_object(
    'participants_linked', COALESCE(v_linked, 0),
    'request_user_id', v_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_import_request_meetings_v2(UUID, UUID[], BOOLEAN)
  TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2) meeting_manual_imports
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meeting_manual_imports (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                  UUID NOT NULL REFERENCES public.meeting_data_import_requests(id) ON DELETE CASCADE,
  user_id                     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  -- 入力 (admin が貼り付け)
  title                       TEXT,
  meeting_date                DATE,
  participant_names           TEXT[],          -- 任意 (csv 風)
  manual_transcript           TEXT NOT NULL,
  manual_summary              TEXT,
  -- 後で AI 抽出で meeting_transcripts に昇格させた場合の参照
  processed_to_transcript_id  UUID REFERENCES public.meeting_transcripts(id) ON DELETE SET NULL,
  created_by                  UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(manual_transcript) BETWEEN 1 AND 200000)
);

CREATE INDEX IF NOT EXISTS idx_manual_imports_request
  ON public.meeting_manual_imports(request_id);
CREATE INDEX IF NOT EXISTS idx_manual_imports_user
  ON public.meeting_manual_imports(user_id);

ALTER TABLE public.meeting_manual_imports ENABLE ROW LEVEL SECURITY;

-- service_role: 全権限
DROP POLICY IF EXISTS "service_manual_imports" ON public.meeting_manual_imports;
CREATE POLICY "service_manual_imports"
  ON public.meeting_manual_imports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- admin: 全 SELECT/INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "admin_manual_imports" ON public.meeting_manual_imports;
CREATE POLICY "admin_manual_imports"
  ON public.meeting_manual_imports
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND is_admin = true
    )
  );

-- 申請者本人: 自分の取込結果は SELECT 可 (透明性)
DROP POLICY IF EXISTS "owner_select_manual_imports" ON public.meeting_manual_imports;
CREATE POLICY "owner_select_manual_imports"
  ON public.meeting_manual_imports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
