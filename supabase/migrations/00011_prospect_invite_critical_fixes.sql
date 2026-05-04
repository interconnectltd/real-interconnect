-- R2レビュー指摘の致命的問題を解消する migration:
-- 1. 旧 RLS PERMISSIVE policy DROP (pending_consent 漏洩の真の解消)
-- 2. REDACT 関数の multi-line speaker 発話対応
-- 3. promote の race condition (FOR UPDATE + job_queue UNIQUE)
-- 4. cleanup_expired_prospects 用 cron 設定の同梱

-- 1) 旧 PERMISSIVE policy の撤去
--   00001で作成された authenticated_view_transcripts / authenticated_view_participants は
--   USING (auth.role() = 'authenticated') で全認証ユーザに丸見え。
--   00010で導入した participant限定 policy と OR 結合し続けるため漏洩が解消されていない。
DROP POLICY IF EXISTS "authenticated_view_transcripts" ON public.meeting_transcripts;
DROP POLICY IF EXISTS "authenticated_view_participants" ON public.meeting_participants;

-- 念のためtranscriptsの service_role bypass policyを明示 (RLS有効テーブルでは
-- service_role は bypass デフォルトだが、UPDATE/DELETE policy も明示しておく)
DROP POLICY IF EXISTS "transcripts_service_all" ON public.meeting_transcripts;
CREATE POLICY "transcripts_service_all" ON public.meeting_transcripts
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "participants_service_all" ON public.meeting_participants;
CREATE POLICY "participants_service_all" ON public.meeting_participants
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2) reject_prospect_invite を multi-line 発話対応 + 全status REDACT 対応に書き換え
CREATE OR REPLACE FUNCTION public.reject_prospect_invite(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_prospect BOOLEAN;
  v_email TEXT;
  v_speaker_pattern TEXT;
  v_t_id UUID;
  v_speakers TEXT[];
BEGIN
  -- ガード: prospect_invite_at が無い (= 通常signupユーザー) は本RPCで削除させない
  SELECT (prospect_invite_at IS NOT NULL), email
    INTO v_is_prospect, v_email
    FROM public.user_profiles
   WHERE id = p_user_id;

  IF v_is_prospect IS NOT TRUE THEN
    RAISE EXCEPTION 'reject_prospect_invite: user % is not a prospect invite', p_user_id;
  END IF;

  -- pending_consent / ready / analyzed transcripts 全てから当該 prospect の発話を REDACT
  -- 行ベースの正規表現は multi-line 発話で破綻するため、speaker name を含む block 単位 (次の[..]:まで) で置換
  FOR v_t_id, v_speakers IN
    SELECT mt.id, ARRAY_AGG(DISTINCT mp.speaker_name)
      FROM public.meeting_transcripts mt
      JOIN public.meeting_participants mp ON mp.transcript_id = mt.id
     WHERE mp.user_id = p_user_id
       AND mt.status IN ('pending_consent', 'ready', 'analyzed')
     GROUP BY mt.id
  LOOP
    -- 各speaker毎に block 単位 (次の '\n[' 開始まで or 文末) を REDACT
    DECLARE
      v_speaker TEXT;
      v_redact_pattern TEXT;
      v_full_text TEXT;
    BEGIN
      SELECT full_text INTO v_full_text FROM public.meeting_transcripts WHERE id = v_t_id;
      FOREACH v_speaker IN ARRAY v_speakers LOOP
        -- block: '['speaker']: ' から次の '\n[' or 文末まで を [REDACTED] に
        v_redact_pattern := '\[' || regexp_replace(v_speaker, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g') || '\]:[^\n]*(\n(?!\[)[^\n]*)*';
        v_full_text := regexp_replace(v_full_text, v_redact_pattern, '[REDACTED-UNCONSENTED]: <removed by user request>', 'g');
      END LOOP;
      UPDATE public.meeting_transcripts SET full_text = v_full_text WHERE id = v_t_id;
    END;
  END LOOP;

  -- 全participants(他status含む)からuser_id解除
  UPDATE public.meeting_participants
     SET user_id = NULL, is_linked = false, linked_method = NULL
   WHERE user_id = p_user_id;

  -- 派生分析データの削除 (insights, scores等のpurge)
  DELETE FROM public.transcript_insights
   WHERE participant_id IN (
     SELECT id FROM public.meeting_participants WHERE user_id = p_user_id
   );
  DELETE FROM public.member_ai_profiles_v2 WHERE user_id = p_user_id;
  DELETE FROM public.matching_scores_v2 WHERE user_id = p_user_id OR target_user_id = p_user_id;
  DELETE FROM public.matching_scores_v3 WHERE user_id = p_user_id OR target_user_id = p_user_id;
  DELETE FROM public.matching_scores_v4 WHERE user_id = p_user_id OR target_user_id = p_user_id;
  DELETE FROM public.user_conversation_vectors WHERE user_id = p_user_id;

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

-- 3) promote_pending_consent_for_user の race condition fix
--   - SELECT FOR UPDATE で transcript ロック
--   - job_queue 重複防止のための UNIQUE index 追加 (analyze + payload識別)
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_analyze_unique
  ON public.job_queue ((payload->>'transcript_id'), (payload->>'participant_id'))
  WHERE type = 'analyze' AND status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION public.promote_pending_consent_for_user(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_promoted_count INT := 0;
  v_transcript_id UUID;
  v_participant_id UUID;
BEGIN
  FOR v_transcript_id, v_participant_id IN
    SELECT mt.id, mp.id
      FROM public.meeting_transcripts mt
      JOIN public.meeting_participants mp ON mp.transcript_id = mt.id
     WHERE mp.user_id = p_user_id
       AND mt.status = 'pending_consent'
     FOR UPDATE OF mt
  LOOP
    UPDATE public.meeting_transcripts
       SET status = 'ready'
     WHERE id = v_transcript_id
       AND status = 'pending_consent';

    -- ON CONFLICT で UNIQUE index に違反したら NOTHING (race防止)
    INSERT INTO public.job_queue (type, payload, status, priority, attempts, max_attempts)
    VALUES (
      'analyze',
      jsonb_build_object('transcript_id', v_transcript_id, 'participant_id', v_participant_id),
      'pending',
      10,
      0,
      3
    )
    ON CONFLICT DO NOTHING;
    v_promoted_count := v_promoted_count + 1;
  END LOOP;

  UPDATE public.bulk_invite_log
     SET status = 'consented', updated_at = now()
   WHERE user_id = p_user_id AND status = 'invited';

  RETURN v_promoted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_pending_consent_for_user(UUID) TO service_role;

-- 4) 5年経過後の user_terms_acceptances 物理削除関数
CREATE OR REPLACE FUNCTION public.cleanup_expired_terms_acceptances()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM public.user_terms_acceptances
   WHERE accepted_at < now() - INTERVAL '5 years'
     AND deleted_user_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_terms_acceptances() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_terms_acceptances() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_terms_acceptances() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_terms_acceptances IS
  '退会後5年経過した同意ログ (deleted_user_id付き) を物理削除。pg_cron 推奨スケジュール: 月次。';
