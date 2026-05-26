-- 00067: login_sessions を拡張 — admin がユーザーの IP/UA/リファラーを閲覧可能に
-- 既存カラム: id, user_id, device, browser, ip_address, created_at

ALTER TABLE public.login_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS os         TEXT,
  ADD COLUMN IF NOT EXISTS referrer   TEXT;

-- admin が全ユーザーのセッションを閲覧できるポリシー
DROP POLICY IF EXISTS "admin_select_login_sessions" ON public.login_sessions;
CREATE POLICY "admin_select_login_sessions"
  ON public.login_sessions FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- service_role は RLS bypass するため policy 不要

-- admin 問い合わせ用 index
CREATE INDEX IF NOT EXISTS idx_login_sessions_user_created
  ON public.login_sessions(user_id, created_at DESC);
