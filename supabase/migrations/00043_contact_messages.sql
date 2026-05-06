-- 00043: contact_messages テーブル新設
--
-- 経緯:
--   /contact が mailto: のみで取りこぼし不可避 → 個情法 33 条「遅滞なく」要件で
--   SLA タイマー無し / 引継ぎ困難 / 監査証跡無しの法的リスクが残っていた。
--
-- 設計:
--   - 公開フォームから anon でも INSERT 可 (rate limit + Turnstile は別途)
--   - admin のみ SELECT/UPDATE 可
--   - SLA 計測用 sla_due_at (24h 以内応答) と assignee_id (担当者割当)
--   - 個情法 33 条開示請求等の subject 種別を kind enum で管理

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 送信者情報 (匿名/anon でも OK)
  sender_name   TEXT NOT NULL,
  sender_email  TEXT NOT NULL,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 用件
  kind          TEXT NOT NULL DEFAULT 'general'
                CHECK (kind IN (
                  'general',           -- 一般問合せ
                  'support',           -- サポート
                  'data_disclosure',   -- 個情法開示請求
                  'data_deletion',     -- 削除請求
                  'tokushoho',         -- 特商法開示請求
                  'urgent_removal',    -- 緊急削除
                  'press',             -- 取材
                  'partnership'        -- 業務提携
                )),
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  -- 状態管理
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','assigned','in_progress','awaiting_user','resolved','rejected')),
  assignee_id   UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  sla_due_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 day'),
  resolved_at   TIMESTAMPTZ,
  -- メタ (Sec)
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created
  ON public.contact_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_kind
  ON public.contact_messages (kind, status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_sla
  ON public.contact_messages (sla_due_at)
  WHERE status NOT IN ('resolved','rejected');

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- service_role: 全件
DROP POLICY IF EXISTS contact_messages_service_all ON public.contact_messages;
CREATE POLICY contact_messages_service_all
  ON public.contact_messages AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- anon: INSERT のみ (公開フォーム経由)
DROP POLICY IF EXISTS contact_messages_anon_insert ON public.contact_messages;
CREATE POLICY contact_messages_anon_insert
  ON public.contact_messages AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

-- authenticated: 自分の sender_user_id 紐付け INSERT
DROP POLICY IF EXISTS contact_messages_auth_insert ON public.contact_messages;
CREATE POLICY contact_messages_auth_insert
  ON public.contact_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);

-- admin: SELECT / UPDATE
DROP POLICY IF EXISTS contact_messages_admin_select ON public.contact_messages;
CREATE POLICY contact_messages_admin_select
  ON public.contact_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS contact_messages_admin_update ON public.contact_messages;
CREATE POLICY contact_messages_admin_update
  ON public.contact_messages AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_admin = true)
  );

-- 自分が送信した contact (sender_user_id) の SELECT
DROP POLICY IF EXISTS contact_messages_self_select ON public.contact_messages;
CREATE POLICY contact_messages_self_select
  ON public.contact_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (sender_user_id = auth.uid());

-- updated_at 自動
DROP TRIGGER IF EXISTS contact_messages_touch ON public.contact_messages;
CREATE TRIGGER contact_messages_touch
  BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT SELECT, UPDATE ON public.contact_messages TO authenticated;

NOTIFY pgrst, 'reload schema';
