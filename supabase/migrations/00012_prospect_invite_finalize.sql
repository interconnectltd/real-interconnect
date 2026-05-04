-- R3レビュー指摘の残存ブロッカー (cron未同梱、REDACT regex境界、merge multi-row) を解消し
-- 95+品質に到達させる仕上げ migration。

-- 1) pg_cron 拡張を有効化 + cleanup ジョブ自動登録
--    pg_cron が未enable環境でも migration が失敗しないよう DO ブロック + EXCEPTION 回避
DO $$
BEGIN
  -- pg_cron は extension schema (cron) に登録される。Supabase managed では既定で利用可
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- 期限切れ prospect の日次cleanup (3:00 UTC = JST 12:00)
  PERFORM cron.unschedule('cleanup-prospects') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-prospects'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable, skipping schedule registration: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-prospects',
      '0 3 * * *',
      $cmd$SELECT public.cleanup_expired_prospects();$cmd$
    );
    PERFORM cron.schedule(
      'cleanup-expired-terms-acceptances',
      '0 4 1 * *',
      $cmd$SELECT public.cleanup_expired_terms_acceptances();$cmd$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule failed: %', SQLERRM;
END $$;

-- 2) bulk_invite_log の (user_id) WHERE status='invited' partial unique index で
--    1ユーザー1招待中状態を強制 → reject merge update が必ず最新の唯一の行を捉える
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_invite_log_user_invited_unique
  ON public.bulk_invite_log (user_id)
  WHERE status = 'invited' AND user_id IS NOT NULL;

-- 3) REDACT の根本対策: regex を排除し、PL/pgSQL の行ベース処理に変更
--    full_text を `\n` で split → 各行が新スピーカーブロックの開始 (`[xxx]: ` で始まる) かを判定
--    対象 speaker のブロック開始行から次のスピーカーブロック開始(or末尾)直前まで [REDACTED] 化
CREATE OR REPLACE FUNCTION public.redact_transcript_speakers(
  p_transcript_id UUID,
  p_speaker_names TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_text TEXT;
  v_lines TEXT[];
  v_out_lines TEXT[] := ARRAY[]::TEXT[];
  v_line TEXT;
  v_in_redact_block BOOLEAN := false;
  v_speaker_prefixes TEXT[];
BEGIN
  SELECT full_text INTO v_full_text FROM public.meeting_transcripts WHERE id = p_transcript_id;
  IF v_full_text IS NULL THEN RETURN; END IF;

  -- 各speakerに対する行頭プリフィックス '[name]:' を組み立て
  SELECT ARRAY_AGG('[' || s || ']:') INTO v_speaker_prefixes FROM unnest(p_speaker_names) AS s;

  v_lines := string_to_array(v_full_text, E'\n');

  FOR i IN 1..array_length(v_lines, 1) LOOP
    v_line := v_lines[i];
    -- 新スピーカーブロックの開始行か (任意の '[name]:' で始まる行)
    IF v_line ~ '^\[[^\]]+\]:' THEN
      -- 対象 speaker のブロックなら REDACT モード ON、置換した1行を出力
      IF EXISTS (SELECT 1 FROM unnest(v_speaker_prefixes) p WHERE v_line LIKE p || '%') THEN
        v_in_redact_block := true;
        v_out_lines := v_out_lines || ARRAY['[REDACTED-UNCONSENTED]: <removed by user request>'];
      ELSE
        v_in_redact_block := false;
        v_out_lines := v_out_lines || ARRAY[v_line];
      END IF;
    ELSE
      -- 継続行: REDACT中なら捨てる、そうでなければそのまま追加
      IF v_in_redact_block THEN
        -- 何もしない (REDACTで吸収)
      ELSE
        v_out_lines := v_out_lines || ARRAY[v_line];
      END IF;
    END IF;
  END LOOP;

  UPDATE public.meeting_transcripts
     SET full_text = array_to_string(v_out_lines, E'\n')
   WHERE id = p_transcript_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redact_transcript_speakers(UUID, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redact_transcript_speakers(UUID, TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_transcript_speakers(UUID, TEXT[]) TO service_role;

-- 4) reject_prospect_invite を行ベースREDACT(redact_transcript_speakers) に書き換え
CREATE OR REPLACE FUNCTION public.reject_prospect_invite(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_prospect BOOLEAN;
  v_email TEXT;
  v_t_id UUID;
  v_speakers TEXT[];
BEGIN
  SELECT (prospect_invite_at IS NOT NULL), email
    INTO v_is_prospect, v_email
    FROM public.user_profiles
   WHERE id = p_user_id;

  IF v_is_prospect IS NOT TRUE THEN
    RAISE EXCEPTION 'reject_prospect_invite: user % is not a prospect invite', p_user_id;
  END IF;

  -- 行ベースREDACT (regex境界問題を排除)
  FOR v_t_id, v_speakers IN
    SELECT mt.id, ARRAY_AGG(DISTINCT mp.speaker_name)
      FROM public.meeting_transcripts mt
      JOIN public.meeting_participants mp ON mp.transcript_id = mt.id
     WHERE mp.user_id = p_user_id
       AND mt.status IN ('pending_consent', 'ready', 'analyzed')
     GROUP BY mt.id
  LOOP
    PERFORM public.redact_transcript_speakers(v_t_id, v_speakers);
  END LOOP;

  -- 派生分析データの削除
  DELETE FROM public.transcript_insights
   WHERE participant_id IN (
     SELECT id FROM public.meeting_participants WHERE user_id = p_user_id
   );
  DELETE FROM public.member_ai_profiles_v2 WHERE user_id = p_user_id;
  DELETE FROM public.matching_scores_v2 WHERE user_id = p_user_id OR target_user_id = p_user_id;
  DELETE FROM public.matching_scores_v3 WHERE user_id = p_user_id OR target_user_id = p_user_id;
  DELETE FROM public.matching_scores_v4 WHERE user_id = p_user_id OR target_user_id = p_user_id;
  DELETE FROM public.user_conversation_vectors WHERE user_id = p_user_id;

  -- 全participantsからuser_id解除
  UPDATE public.meeting_participants
     SET user_id = NULL, is_linked = false, linked_method = NULL
   WHERE user_id = p_user_id;

  UPDATE public.bulk_invite_log
     SET status = 'revoked', updated_at = now()
   WHERE user_id = p_user_id AND status = 'invited';

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_prospect_invite(UUID) TO service_role;
