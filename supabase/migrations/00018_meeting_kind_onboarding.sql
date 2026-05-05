-- 00018_meeting_kind_onboarding.sql
--
-- ユーザー指摘:
--   「アカウント作ったばっかりだと初回のMTは運営とやってると思うので、それの
--    アカウントと会議の紐づけしないとその人の正常なデータ作られない」
--
-- 設計判断:
--   - 運営オペレーター email を env (INTERCONNECT_OPERATOR_EMAILS) で持ち、
--     classify-meeting がそのemailを参加者に検出 → meeting_kind = 'onboarding'
--   - 'onboarding' kind は AI 解析・招待ループ・マッチング寄与の全てから除外
--   - 運営の発話で「ユーザーの嗜好」が誤学習されることを物理的に防止
--   - 商談 transcript と分けて表示 (UI 上の専用バッジ予定)

-- 1) meeting_kind enum に 'onboarding' を追加
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_kind') THEN
    BEGIN
      ALTER TYPE public.meeting_kind ADD VALUE IF NOT EXISTS 'onboarding';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'meeting_kind onboarding already exists or skip: %', SQLERRM;
    END;
  END IF;
END $$;

-- 2) transcript_status enum に 'onboarding' を追加 (AI解析対象外)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'meeting_transcripts'
       AND column_name = 'status'
       AND data_type = 'USER-DEFINED'
  ) THEN
    BEGIN
      ALTER TYPE public.transcript_status ADD VALUE IF NOT EXISTS 'onboarding';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'transcript_status onboarding already exists or skip: %', SQLERRM;
    END;
  END IF;
END $$;

COMMENT ON TYPE public.meeting_kind IS
  'sales=商談 (招待+AI解析), internal=社内 (除外), onboarding=運営との面談 (除外), unknown=判定不能 (admin review)';
