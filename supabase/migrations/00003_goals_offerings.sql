-- ============================================================
-- Migration 00003: Goals/Offerings + Invitation Codes + Onboarding
-- Based on: interconnect設計書完全版 1_Onboarding
-- ============================================================

-- ── 1. 招待コードテーブル ──

CREATE TABLE public.invitation_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  created_by    UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  used_by       UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  max_uses      INT NOT NULL DEFAULT 1,
  use_count     INT NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitation_codes_code ON public.invitation_codes(code) WHERE is_active = true;

-- ── 2. Goals/Offerings (6カテゴリ) ──

CREATE TYPE public.goal_type AS ENUM (
  'partnership',    -- 事業提携
  'consulting',     -- 経営相談
  'investment',     -- 投資
  'hiring',         -- 採用
  'info_exchange',  -- 情報交換
  'mentoring'       -- メンタリング
);

-- ユーザーの目的（求めていること）
CREATE TABLE public.user_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type        public.goal_type NOT NULL,
  context     TEXT,  -- 具体的文脈（例: "SaaS ARR3億→10億の壁突破経験者を求む"）
  confidence  FLOAT DEFAULT 1.0,  -- Haiku抽出時の信頼度
  source      TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'haiku', 'sonnet')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, type)
);

-- ユーザーの提供物（提供できること）
CREATE TABLE public.user_offerings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type        public.goal_type NOT NULL,
  context     TEXT,  -- 具体的文脈（例: "製造業DX 15年の実務経験"）
  confidence  FLOAT DEFAULT 1.0,
  source      TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'haiku', 'sonnet')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, type)
);

CREATE INDEX idx_user_goals_user ON public.user_goals(user_id);
CREATE INDEX idx_user_offerings_user ON public.user_offerings(user_id);

-- ── 3. user_profiles にオンボーディング状態を追加 ──

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_step INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invitation_code_id UUID REFERENCES public.invitation_codes(id),
  ADD COLUMN IF NOT EXISTS maturity_level INT DEFAULT 1 CHECK (maturity_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS linkedin_id TEXT,
  ADD COLUMN IF NOT EXISTS avatar_source TEXT DEFAULT 'manual' CHECK (avatar_source IN ('manual', 'linkedin', 'facebook'));

-- ── 4. RLS ──

ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_offerings ENABLE ROW LEVEL SECURITY;

-- 招待コード: 認証ユーザーが検証可能、管理者が全操作
CREATE POLICY "authenticated_check_codes" ON public.invitation_codes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "admin_manage_codes" ON public.invitation_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Goals: 自分のgoals操作 + 認証ユーザーが他人のgoals閲覧
CREATE POLICY "own_goals" ON public.user_goals
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "authenticated_view_goals" ON public.user_goals
  FOR SELECT USING (auth.role() = 'authenticated');

-- Offerings: 同様
CREATE POLICY "own_offerings" ON public.user_offerings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "authenticated_view_offerings" ON public.user_offerings
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── 5. Goals/Offerings ラベル定義（アプリ側定数と同期用コメント） ──
-- partnership  = 事業提携
-- consulting   = 経営相談
-- investment   = 投資
-- hiring       = 採用
-- info_exchange = 情報交換
-- mentoring    = メンタリング
