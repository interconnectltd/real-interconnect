-- 00049: ICS フィード token テーブル + ローテーション
--
-- ユーザーが Google Calendar / Outlook などに購読 URL を登録するための
-- 推測不能な token を発行・ローテーションする仕組み。
-- 配信は /api/v1/calendar/feed/[token] が ICS を返す。
--
-- セキュリティ:
--   - token は 256bit ランダム (URL-safe base64 ≈ 43 char)
--   - revoked_at IS NULL のみ有効
--   - rotate 時は古い token を即時 revoke (gap なし)
--   - RLS は本人 SELECT/INSERT/UPDATE のみ、ICS 配信は service_role bypass

CREATE TABLE IF NOT EXISTS public.user_calendar_feed_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- 「現有効 token は user 1 行」ルール: revoked_at IS NULL は user_id ごと unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_tokens_active_per_user
  ON public.user_calendar_feed_tokens(user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feed_tokens_lookup
  ON public.user_calendar_feed_tokens(token) WHERE revoked_at IS NULL;

ALTER TABLE public.user_calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_feed_tokens_all" ON public.user_calendar_feed_tokens;
CREATE POLICY "service_feed_tokens_all"
  ON public.user_calendar_feed_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "self_feed_tokens" ON public.user_calendar_feed_tokens;
CREATE POLICY "self_feed_tokens"
  ON public.user_calendar_feed_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- token 発行/ローテーション RPC
--   現有効 token があれば revoke し、新 token を 1 件作成。
--   呼び出し側は token を保持するのは初回 1 回 (URL 1 回提示) でよい設計を想定。
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rotate_calendar_feed_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_token TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'rotate_calendar_feed_token: not authenticated';
  END IF;

  -- 256bit ランダム → URL-safe (replace +/ → -_、= 削除)
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  -- 既存有効 token を revoke (UNIQUE partial index 衝突回避)
  UPDATE public.user_calendar_feed_tokens
     SET revoked_at = now()
   WHERE user_id = v_user AND revoked_at IS NULL;

  INSERT INTO public.user_calendar_feed_tokens (user_id, token)
       VALUES (v_user, v_token);

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rotate_calendar_feed_token() TO authenticated;
