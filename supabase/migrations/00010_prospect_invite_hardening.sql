-- prospect招待パイプラインのR1レビュー指摘を反映するハードニング migration。
-- 主な対応:
--   ・ai_cross_border 同意の正式追加 (越境移転同意のエビデンス保全)
--   ・RPC EXECUTE 権限制御 (任意ユーザーの reject 不可)
--   ・reject_prospect_invite に prospect_invite ガード追加
--   ・user_terms_acceptances FK CASCADE → SET NULL + email snapshot (退会後5年保持)
--   ・meeting_transcripts/participants RLS 強化 (pending_consent 閲覧禁止)
--   ・reject時の transcript REDACT
--   ・stale prospect (14日未同意) の cleanup function

-- 1) terms_versions に kind='ai_cross_border' を追加
ALTER TABLE public.terms_versions
  DROP CONSTRAINT IF EXISTS terms_versions_kind_check;
ALTER TABLE public.terms_versions
  ADD CONSTRAINT terms_versions_kind_check
  CHECK (kind IN ('terms', 'privacy', 'tokushoho', 'ai_cross_border'));

ALTER TABLE public.user_terms_acceptances
  DROP CONSTRAINT IF EXISTS user_terms_acceptances_kind_check;
ALTER TABLE public.user_terms_acceptances
  ADD CONSTRAINT user_terms_acceptances_kind_check
  CHECK (kind IN ('terms', 'privacy', 'tokushoho', 'ai_cross_border'));

INSERT INTO public.terms_versions (kind, version, effective_from)
VALUES ('ai_cross_border', '2026-05-04', now())
ON CONFLICT (kind, version) DO NOTHING;

-- 2) user_terms_acceptances FK を SET NULL + email snapshot で退会後5年保持を技術的に保証
ALTER TABLE public.user_terms_acceptances
  ADD COLUMN IF NOT EXISTS email_at_acceptance TEXT,
  ADD COLUMN IF NOT EXISTS deleted_user_id UUID;

ALTER TABLE public.user_terms_acceptances
  DROP CONSTRAINT IF EXISTS user_terms_acceptances_user_id_fkey;
ALTER TABLE public.user_terms_acceptances
  ADD CONSTRAINT user_terms_acceptances_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- auth.users削除時にemail_at_acceptance/deleted_user_idを保全するトリガ
CREATE OR REPLACE FUNCTION public.archive_user_terms_acceptances_on_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.user_terms_acceptances
     SET deleted_user_id = OLD.id,
         email_at_acceptance = COALESCE(email_at_acceptance, OLD.email)
   WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS archive_terms_acceptances_before_user_delete ON auth.users;
CREATE TRIGGER archive_terms_acceptances_before_user_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.archive_user_terms_acceptances_on_user_delete();

-- 3) RPC EXECUTE 権限制御 (PUBLIC を REVOKE、service_role のみ許可)
REVOKE EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) TO service_role;

-- 4) reject_prospect_invite に prospect_invite ガード追加 + transcript REDACT
CREATE OR REPLACE FUNCTION public.reject_prospect_invite(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_prospect BOOLEAN;
  v_email TEXT;
BEGIN
  -- ガード: prospect_invite_at が無い (= 通常signupユーザー) は本RPCで削除させない
  SELECT (prospect_invite_at IS NOT NULL), email
    INTO v_is_prospect, v_email
    FROM public.user_profiles
   WHERE id = p_user_id;

  IF v_is_prospect IS NOT TRUE THEN
    RAISE EXCEPTION 'reject_prospect_invite: user % is not a prospect invite', p_user_id;
  END IF;

  -- pending_consent な transcript で当該ユーザーの発話セグメントを REDACT
  -- (full_text は "[speaker]: text" 形式のため speaker_name行を [REDACTED-UNCONSENTED] に置換)
  WITH speakers AS (
    SELECT DISTINCT mp.speaker_name, mp.transcript_id
      FROM public.meeting_participants mp
     WHERE mp.user_id = p_user_id
       AND mp.transcript_id IN (
         SELECT id FROM public.meeting_transcripts WHERE status = 'pending_consent'
       )
  )
  UPDATE public.meeting_transcripts mt
     SET full_text = regexp_replace(
           full_text,
           '^\[' || regexp_replace(s.speaker_name, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g') || '\]: .*$',
           '[REDACTED-UNCONSENTED]: <removed by user request>',
           'gm'
         )
    FROM speakers s
   WHERE mt.id = s.transcript_id;

  -- pending_consent transcripts の participant 紐付けを解除
  UPDATE public.meeting_participants
     SET user_id = NULL, is_linked = false, linked_method = NULL
   WHERE user_id = p_user_id
     AND transcript_id IN (
       SELECT id FROM public.meeting_transcripts WHERE status = 'pending_consent'
     );

  -- 全participants(他status含む)からuser_id解除でも同様に脱獄
  UPDATE public.meeting_participants
     SET user_id = NULL, is_linked = false, linked_method = NULL
   WHERE user_id = p_user_id;

  -- bulk_invite_log を revoked に
  UPDATE public.bulk_invite_log
     SET status = 'revoked', updated_at = now()
   WHERE user_id = p_user_id AND status = 'invited';

  -- auth.users 削除 (BEFORE DELETE trigger で user_terms_acceptances に email snapshot 保存)
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) TO service_role;

-- 5) RLS強化: pending_consent transcripts は participant でも閲覧不可
DROP POLICY IF EXISTS "transcripts_select" ON public.meeting_transcripts;
CREATE POLICY "transcripts_select" ON public.meeting_transcripts
  FOR SELECT
  USING (
    -- service_role はバイパス (RLS ENABLEテーブルでも service_role はバイパス)
    -- 一般ユーザーは: 自分が participant かつ status != 'pending_consent'
    status != 'pending_consent'
    AND EXISTS (
      SELECT 1 FROM public.meeting_participants mp
      WHERE mp.transcript_id = meeting_transcripts.id
        AND mp.user_id = auth.uid()
    )
  );

-- meeting_participants も同様
DROP POLICY IF EXISTS "participants_select" ON public.meeting_participants;
CREATE POLICY "participants_select" ON public.meeting_participants
  FOR SELECT
  USING (
    -- 自分の participant 行は status関係なく見られる (consent gate UI で必要)
    user_id = auth.uid()
    OR
    -- 他人の participant でも、同じtranscriptの自分のparticipantが存在し、かつ status='ready'/'analyzed' なら可
    EXISTS (
      SELECT 1
        FROM public.meeting_participants my
        JOIN public.meeting_transcripts mt ON mt.id = my.transcript_id
       WHERE my.transcript_id = meeting_participants.transcript_id
         AND my.user_id = auth.uid()
         AND mt.status IN ('ready', 'analyzed')
    )
  );

-- 6) prospect_invite_at に expires_at を併設 (14日経過の自動クリーンアップ)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS prospect_invite_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.prospect_invite_expires_at IS
  '招待後14日 (default)。これを過ぎても同意せず未login状態なら cleanup_expired_prospects() で削除される。';

-- 7) cleanup_expired_prospects: cron用 (期限切れprospectの自動削除)
CREATE OR REPLACE FUNCTION public.cleanup_expired_prospects()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_count INT := 0;
BEGIN
  FOR v_user_id IN
    SELECT up.id FROM public.user_profiles up
    LEFT JOIN public.user_terms_acceptances uta ON uta.user_id = up.id
    WHERE up.prospect_invite_at IS NOT NULL
      AND up.prospect_invite_expires_at IS NOT NULL
      AND up.prospect_invite_expires_at < now()
      AND uta.id IS NULL
  LOOP
    PERFORM public.reject_prospect_invite(v_user_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_prospects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_prospects() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_prospects() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_prospects IS
  '期限切れ未同意prospectを reject_prospect_invite で一括削除。 pg_cron で日次実行を推奨: SELECT cron.schedule(''cleanup-prospects'',''0 3 * * *'',$$SELECT cleanup_expired_prospects();$$);';
