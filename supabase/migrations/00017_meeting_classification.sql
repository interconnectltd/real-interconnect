-- 00017_meeting_classification.sql
--
-- tl;dv meeting を「商談 (sales) / 社内 (internal) / 不明 (unknown)」に分類し、
-- 招待ループ・AI解析の対象を商談のみに絞り込むためのカラム拡張。
--
-- 背景:
--   現状は webhook 受信時に全 meeting を一律 prospect 招待対象にしており、
--   定例会議や 1on1 等の社内ミーティングでも社内同僚の email に招待メールが
--   送信される事故リスクがあった。lib/tldv/classify-meeting.ts でタイトル/
--   ドメイン/参加者ベースの分類器を実装したので、その結果を永続化する。
--
-- 動作:
--   1. meeting_transcripts.meeting_kind を新設 (sales/internal/unknown)
--   2. meeting_transcripts.classification_reason を新設 (admin デバッグ用)
--   3. status enum に 'internal' を追加 (= 招待対象外、AI解析もスキップ)
--   4. cleanup_internal_transcripts 関数 (任意削除用、初期は呼ばない)

-- 1) meeting_kind enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_kind') THEN
    CREATE TYPE public.meeting_kind AS ENUM ('sales', 'internal', 'unknown');
  END IF;
END $$;

-- 2) meeting_transcripts に分類カラム
ALTER TABLE public.meeting_transcripts
  ADD COLUMN IF NOT EXISTS meeting_kind public.meeting_kind NOT NULL DEFAULT 'unknown';

ALTER TABLE public.meeting_transcripts
  ADD COLUMN IF NOT EXISTS classification_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_kind
  ON public.meeting_transcripts(meeting_kind);

-- 3) transcript_status enum に 'internal' を追加 (招待対象外)
DO $$
BEGIN
  -- 既存の status カラムが TEXT か enum かを動的に判定
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'meeting_transcripts'
       AND column_name = 'status'
       AND data_type = 'USER-DEFINED'
  ) THEN
    -- enum なら ADD VALUE
    BEGIN
      ALTER TYPE public.transcript_status ADD VALUE IF NOT EXISTS 'internal';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'transcript_status enum value internal already added or skip: %', SQLERRM;
    END;
  END IF;
  -- TEXT カラムなら CHECK 制約のみで足りるが、現状 status は enum 想定
END $$;

COMMENT ON COLUMN public.meeting_transcripts.meeting_kind IS
  '会議分類: sales=商談 (招待+AI解析対象), internal=社内 (除外), unknown=判定不能 (admin review)';
COMMENT ON COLUMN public.meeting_transcripts.classification_reason IS
  'classifyMeeting() の判定理由文字列。admin が誤分類調査に使う';

-- 4) 内部会議のみ手動削除する管理関数 (RLS用、初期は呼ばない)
CREATE OR REPLACE FUNCTION public.cleanup_internal_transcripts(p_older_than_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH d AS (
    DELETE FROM public.meeting_transcripts
     WHERE meeting_kind = 'internal'
       AND fetched_at < now() - (p_older_than_days || ' days')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_internal_transcripts(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_internal_transcripts(INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_internal_transcripts(INT) TO service_role;
