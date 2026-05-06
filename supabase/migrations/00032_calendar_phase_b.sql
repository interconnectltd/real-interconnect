-- 00032_calendar_phase_b.sql
--
-- Phase B (Calendar OAuth + 双方向 Meet/Zoom 自動化) の DB 基盤。
--
-- 既存 src/types/database.ts に calendar_connections / availability_rules /
-- availability_overrides の型定義あり。実テーブル未作成だったため本 migration で
-- 整合的に作成 + R3 Phase B レビュー指摘の不足列 (watch_*, timezone) を追加。
--
-- 1. calendar_connections: OAuth token 保管 (AES 暗号化済 base64 文字列)
-- 2. availability_rules: 曜日別営業時間
-- 3. availability_overrides: 特定日の例外
-- 4. RLS: 自分の行のみ
-- 5. Token 暗号化は API 層 (Web Crypto AES-256-GCM) で実施、
--    DB は暗号文 + IV + tag を text (base64) で保管

-- ────────────────────────────────────────
-- 1) calendar_connections
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'ics_feed')),
  provider_email      TEXT NOT NULL,
  access_token_enc    TEXT NOT NULL,           -- base64 of (iv || ciphertext || authTag)
  refresh_token_enc   TEXT,                    -- ICS は null 許容
  token_expires_at    TIMESTAMPTZ,
  -- ICS feed 用
  ics_url             TEXT,
  ics_etag            TEXT,
  sync_cursor         TEXT,
  last_synced_at      TIMESTAMPTZ,
  -- Phase B 追加: timezone と watch_*
  timezone            TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  watch_channel_id    TEXT,
  watch_resource_id   TEXT,
  watch_expires_at    TIMESTAMPTZ,
  -- メタ
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_conn_user
  ON public.calendar_connections(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_calendar_conn_watch_expires
  ON public.calendar_connections(watch_expires_at) WHERE watch_channel_id IS NOT NULL;

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_calendar_full"
  ON public.calendar_connections AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 自分の connection は SELECT 可だが access_token_enc は RPC 経由でしか復号しない (列 grant 制御)
CREATE POLICY "auth_select_own_calendar"
  ON public.calendar_connections AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "auth_delete_own_calendar"
  ON public.calendar_connections AS PERMISSIVE FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- token 列を authenticated SELECT から除外 (R3 Phase B Sec: 平文/暗号文の双方を UI に出さない)
REVOKE SELECT (access_token_enc, refresh_token_enc) ON public.calendar_connections FROM authenticated;
GRANT SELECT (
  id, user_id, provider, provider_email, token_expires_at,
  ics_url, ics_etag, sync_cursor, last_synced_at,
  timezone, watch_channel_id, watch_resource_id, watch_expires_at,
  is_active, created_at, updated_at
) ON public.calendar_connections TO authenticated;

-- ────────────────────────────────────────
-- 2) availability_rules (曜日別営業時間)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.availability_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_avail_rules_user_day
  ON public.availability_rules(user_id, day_of_week) WHERE is_active = true;

ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_avail_rules_full"
  ON public.availability_rules AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_self_avail_rules"
  ON public.availability_rules AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 相手側の availability も connection 経由で読みたい (scheduling 用)
CREATE POLICY "auth_select_connected_avail_rules"
  ON public.availability_rules AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
       WHERE (c.user_id = auth.uid() AND c.connected_user_id = availability_rules.user_id)
          OR (c.connected_user_id = auth.uid() AND c.user_id = availability_rules.user_id)
    )
  );

-- ────────────────────────────────────────
-- 3) availability_overrides
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.availability_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_date     DATE NOT NULL,
  override_type   TEXT NOT NULL CHECK (override_type IN ('block', 'open')),
  start_time      TIME,
  end_time        TIME,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (override_type = 'block') OR
    (override_type = 'open' AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_avail_overrides_user_date
  ON public.availability_overrides(user_id, target_date);

ALTER TABLE public.availability_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_avail_overrides_full"
  ON public.availability_overrides AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_self_avail_overrides"
  ON public.availability_overrides AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "auth_select_connected_avail_overrides"
  ON public.availability_overrides AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
       WHERE (c.user_id = auth.uid() AND c.connected_user_id = availability_overrides.user_id)
          OR (c.connected_user_id = auth.uid() AND c.user_id = availability_overrides.user_id)
    )
  );

-- ────────────────────────────────────────
-- 4) updated_at 自動更新
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS calendar_connections_touch ON public.calendar_connections;
CREATE TRIGGER calendar_connections_touch
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ────────────────────────────────────────
-- 5) Phase B 越境送信 同意 scope を meeting_consents に追加
--    (00027 で meeting_consents 自体は作成済の前提)
-- ────────────────────────────────────────
-- 個情法 28条 / 電通事業法 27条12 の対応:
-- ユーザーは calendar 連携前に google_us_transfer_v1 / zoom_us_transfer_v1
-- に同意する必要がある。同意ログは meeting_consents テーブルで管理。
--
-- (テーブルは 00027 で作成済、本 migration では追加 scope のドキュメント記載のみ)
COMMENT ON TABLE public.calendar_connections IS
  'OAuth tokens are AES-256-GCM encrypted by API layer. ' ||
  'User must consent to google_us_transfer_v1 / zoom_us_transfer_v1 scope ' ||
  'in meeting_consents before connecting (個情法 28条 / 電通事業法 27条12)';
