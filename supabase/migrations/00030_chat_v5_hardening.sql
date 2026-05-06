-- 00030_chat_v5_hardening.sql
--
-- R4 Sec 84 / Arch 91 の最終詰め。Sec 90+ 到達狙い。
--
-- 1. chat_message_idempotency_keys.body_hash text NOT NULL 追加
--    (R4 Sec: payload 差し替え検知、SHA-256 by client+server)
-- 2. pg_cron で purge 関数を 1 時間毎に自動実行
--    (R4 Arch: purge_idempotency_keys を migration で配線、片手落ち解消)
-- 3. C0 制御文字 CHECK のコメント明確化
-- 4. (補強) rate_limits の cleanup も pg_cron に
-- 5. user_profiles の auth_select_connected_profiles policy は 00029 で追加済、
--    rooms GET serviceClient 撤廃は API 側で実施

-- ────────────────────────────────────────
-- 1) idempotency_keys に body_hash 列追加
--    既存運用なし (新機能) のため NOT NULL 即時追加可
-- ────────────────────────────────────────
ALTER TABLE public.chat_message_idempotency_keys
  ADD COLUMN IF NOT EXISTS body_hash TEXT NOT NULL DEFAULT '';

-- DEFAULT '' は最初の migrate で既存行の埋め用、その後 client 必須化で実質常に値あり
ALTER TABLE public.chat_message_idempotency_keys
  ALTER COLUMN body_hash DROP DEFAULT;

-- body_hash は SHA-256 hex (64 chars) を期待
ALTER TABLE public.chat_message_idempotency_keys
  ADD CONSTRAINT chat_idem_body_hash_format
  CHECK (length(body_hash) = 64 OR body_hash = '');

CREATE INDEX IF NOT EXISTS idx_chat_idem_user_key_hash
  ON public.chat_message_idempotency_keys(user_id, idempotency_key, body_hash);

-- ────────────────────────────────────────
-- 2) pg_cron で purge を自動実行
-- ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 既存 schedule あれば一旦 unschedule (再適用安全のため)
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- purge_idempotency_keys: 毎時 5 分
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'chat-purge-idem-keys';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  PERFORM cron.schedule(
    'chat-purge-idem-keys',
    '5 * * * *',
    $JOB$ SELECT public.purge_idempotency_keys() $JOB$
  );

  -- purge_rate_limits: 10 分毎
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'chat-purge-rate-limits';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  PERFORM cron.schedule(
    'chat-purge-rate-limits',
    '*/10 * * * *',
    $JOB$ SELECT public.purge_rate_limits() $JOB$
  );
EXCEPTION
  WHEN insufficient_privilege OR undefined_function THEN
    -- pg_cron が無効化されている場合はスキップ (Self-hosted 環境等)
    RAISE NOTICE 'pg_cron unavailable, skipping schedule';
END $$;

-- ────────────────────────────────────────
-- 3) C0 制御文字 CHECK の意図明確化 (DROP/ADD で再作成、コメント付き)
--    [\x01-\x1F] のうち tab(\x09) / LF(\x0A) / CR(\x0D) を除外、+ DEL(\x7F)
-- ────────────────────────────────────────
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_no_control_chars_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_no_control_chars_check
  CHECK (
    -- C0 制御文字 (NUL/SOH..US, except TAB/LF/CR) と DEL を物理拒否
    -- 範囲: \x01-\x08, \x0B-\x0C, \x0E-\x1F, \x7F
    content !~ '[--	-
-]'
  );

COMMENT ON CONSTRAINT chat_messages_no_control_chars_check ON public.chat_messages IS
  'C0 制御文字 (\x01-\x08, \x0B-\x0C, \x0E-\x1F) + DEL (\x7F) を拒否。tab/LF/CR は許可。';

-- ────────────────────────────────────────
-- 4) check_rate_limit の fail-closed flag 追加
--    p_strict=true なら DB 障害時に false (拒否) を返す版を別関数で提供
-- ────────────────────────────────────────
-- (実装は API 側 checkDbRateLimit に分岐するため、SQL 側は据置)
