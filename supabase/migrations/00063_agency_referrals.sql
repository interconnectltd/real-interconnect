-- 00063_agency_referrals.sql
-- 代理店プログラム全機能: 申請→承認→紹介リンク発行→クリック追跡→紹介管理→
--                       コミッション/出金(雛形)
--
-- 設計判断:
--   * 00062 で user_profiles.is_agency 列追加済 → 本マイグレーションは
--     「申請→承認→運用」フルフローを上乗せ。
--     is_agency=true は agencies.status='approved' のキャッシュとして同期維持。
--   * Agent (=agencies) を user_profiles と 1:1 拡張テーブルとして新設。
--     status / rank / 集計値 / 出金情報をここに集約。
--   * 紹介リンクは 1 代理店 × 複数発行 (用途/キャンペーン別)。Sara 要件。
--   * クリックは referral_clicks に 1 行ずつ記録 (RPC で anon から呼べる)。
--   * Commission/Payout は Stripe 統合時の運用を見越したテーブルのみ作成
--     (status enum・FK・index 完備)。今 phase では INSERT/SELECT API は実装しない。
--   * handle_referral_attribution trigger を user_profiles AFTER INSERT に追加。
--     既存 handle_new_user (invitation_code 消費) は touch しない。
--   * rank 計算は trigger 内で同期 (signed_up time に判定)。 churned 時の降格は
--     現 phase では実装せず (将来追加可)。

BEGIN;

-- ─────────────────────────────────────────────────────────
-- 1) agencies (代理店本体: user_profiles と 1:1)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agencies (
  user_id UUID PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended', 'rejected')),

  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- 集計キャッシュ (trigger / 集計バッチで同期)
  total_clicks INTEGER NOT NULL DEFAULT 0,
  total_referrals INTEGER NOT NULL DEFAULT 0,
  total_earnings_jpy BIGINT NOT NULL DEFAULT 0,
  current_balance_jpy BIGINT NOT NULL DEFAULT 0,

  current_rank TEXT NOT NULL DEFAULT 'bronze'
    CHECK (current_rank IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),

  -- 出金情報 (将来 Stripe Connect 統合時に encrypted 化)
  payout_method TEXT,
  payout_info_encrypted TEXT,
  min_withdrawal_jpy INTEGER NOT NULL DEFAULT 5000,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agencies_status
  ON public.agencies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agencies_rank
  ON public.agencies(current_rank, total_referrals DESC) WHERE status = 'approved';

-- ─────────────────────────────────────────────────────────
-- 2) agency_applications (申請履歴: 履歴として複数残せる)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  applicant_note TEXT,
  admin_note TEXT,
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agency_applications_pending
  ON public.agency_applications(applicant_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agency_applications_status
  ON public.agency_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_applications_applicant
  ON public.agency_applications(applicant_id, created_at DESC);

-- ─────────────────────────────────────────────────────────
-- 3) referral_links (代理店ごとに複数発行)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_user_id UUID NOT NULL REFERENCES public.agencies(user_id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_links_agency
  ON public.referral_links(agency_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_links_active_code
  ON public.referral_links(code) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────
-- 4) referral_clicks (全クリック 1 行 1 記録)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_link_id UUID NOT NULL
    REFERENCES public.referral_links(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  -- IP は SHA-256 hash で保存 (個情法 / GDPR 対策で生 IP は残さない)
  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  converted_to_referral_id UUID,  -- referrals.id (CONFLICT 回避のため FK は後付)
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_link
  ON public.referral_clicks(referral_link_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_visitor
  ON public.referral_clicks(visitor_id, clicked_at DESC);

-- ─────────────────────────────────────────────────────────
-- 5) referrals (紹介済み = 入会到達)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_link_id UUID NOT NULL
    REFERENCES public.referral_links(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL UNIQUE
    REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'signed_up'
    CHECK (status IN ('signed_up', 'paying', 'churned', 'refunded')),
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_payment_at TIMESTAMPTZ,
  churned_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_link
  ON public.referrals(referral_link_id, signed_up_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON public.referrals(status, signed_up_at DESC);

-- referral_clicks.converted_to_referral_id → referrals.id の FK (forward declaration 解決)
ALTER TABLE public.referral_clicks
  DROP CONSTRAINT IF EXISTS referral_clicks_converted_fk;
ALTER TABLE public.referral_clicks
  ADD CONSTRAINT referral_clicks_converted_fk
    FOREIGN KEY (converted_to_referral_id) REFERENCES public.referrals(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────
-- 6) commissions (雛形のみ: Stripe 統合で運用開始)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_user_id UUID NOT NULL REFERENCES public.agencies(user_id) ON DELETE CASCADE,
  referral_id UUID NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
  amount_jpy BIGINT NOT NULL,
  rate NUMERIC(5,4) NOT NULL,  -- 0.2000 = 20%
  basis_jpy BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'paid', 'reversed')),
  payout_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commissions_agency_status
  ON public.commissions(agency_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_referral
  ON public.commissions(referral_id);

-- ─────────────────────────────────────────────────────────
-- 7) payouts (出金履歴 / 雛形)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_user_id UUID NOT NULL REFERENCES public.agencies(user_id) ON DELETE CASCADE,
  amount_jpy BIGINT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  failed_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_payouts_agency_status
  ON public.payouts(agency_user_id, status, requested_at DESC);

-- commissions.payout_id → payouts.id (forward declaration 解決)
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_payout_fk;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_payout_fk
    FOREIGN KEY (payout_id) REFERENCES public.payouts(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────
-- 8) updated_at triggers
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_agencies_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tg_agencies_updated_at ON public.agencies;
CREATE TRIGGER tg_agencies_updated_at BEFORE UPDATE ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.tg_agencies_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_agency_applications_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tg_agency_applications_updated_at ON public.agency_applications;
CREATE TRIGGER tg_agency_applications_updated_at BEFORE UPDATE ON public.agency_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_agency_applications_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_referral_links_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tg_referral_links_updated_at ON public.referral_links;
CREATE TRIGGER tg_referral_links_updated_at BEFORE UPDATE ON public.referral_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_referral_links_set_updated_at();

-- ─────────────────────────────────────────────────────────
-- 9) RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

-- service_role full (worker/admin endpoint 経由)
DROP POLICY IF EXISTS "service_agencies" ON public.agencies;
CREATE POLICY "service_agencies" ON public.agencies FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_agency_applications" ON public.agency_applications;
CREATE POLICY "service_agency_applications" ON public.agency_applications FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_referral_links" ON public.referral_links;
CREATE POLICY "service_referral_links" ON public.referral_links FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_referral_clicks" ON public.referral_clicks;
CREATE POLICY "service_referral_clicks" ON public.referral_clicks FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_referrals" ON public.referrals;
CREATE POLICY "service_referrals" ON public.referrals FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_commissions" ON public.commissions;
CREATE POLICY "service_commissions" ON public.commissions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_payouts" ON public.payouts;
CREATE POLICY "service_payouts" ON public.payouts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- agencies: 本人 SELECT + admin SELECT (UPDATE は service_role 経由のみ)
DROP POLICY IF EXISTS "agencies_select_self_or_admin" ON public.agencies;
CREATE POLICY "agencies_select_self_or_admin"
  ON public.agencies FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- agency_applications
DROP POLICY IF EXISTS "agency_applications_select_self_or_admin" ON public.agency_applications;
CREATE POLICY "agency_applications_select_self_or_admin"
  ON public.agency_applications FOR SELECT TO authenticated
  USING (
    applicant_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS "agency_applications_insert_self" ON public.agency_applications;
CREATE POLICY "agency_applications_insert_self"
  ON public.agency_applications FOR INSERT TO authenticated
  WITH CHECK (applicant_id = auth.uid() AND status = 'pending');

-- referral_links: 代理店 (approved) 本人のみ
DROP POLICY IF EXISTS "referral_links_select_owner" ON public.referral_links;
CREATE POLICY "referral_links_select_owner"
  ON public.referral_links FOR SELECT TO authenticated
  USING (agency_user_id = auth.uid());

DROP POLICY IF EXISTS "referral_links_insert_owner" ON public.referral_links;
CREATE POLICY "referral_links_insert_owner"
  ON public.referral_links FOR INSERT TO authenticated
  WITH CHECK (
    agency_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.agencies WHERE user_id = auth.uid() AND status = 'approved')
  );

DROP POLICY IF EXISTS "referral_links_update_owner" ON public.referral_links;
CREATE POLICY "referral_links_update_owner"
  ON public.referral_links FOR UPDATE TO authenticated
  USING (agency_user_id = auth.uid())
  WITH CHECK (agency_user_id = auth.uid());

-- referral_clicks: link owner のみ SELECT
DROP POLICY IF EXISTS "referral_clicks_select_link_owner" ON public.referral_clicks;
CREATE POLICY "referral_clicks_select_link_owner"
  ON public.referral_clicks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.referral_links rl
      WHERE rl.id = referral_clicks.referral_link_id
        AND rl.agency_user_id = auth.uid()
    )
  );

-- referrals: link owner のみ SELECT
DROP POLICY IF EXISTS "referrals_select_link_owner" ON public.referrals;
CREATE POLICY "referrals_select_link_owner"
  ON public.referrals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.referral_links rl
      WHERE rl.id = referrals.referral_link_id
        AND rl.agency_user_id = auth.uid()
    )
  );

-- commissions
DROP POLICY IF EXISTS "commissions_select_owner_or_admin" ON public.commissions;
CREATE POLICY "commissions_select_owner_or_admin"
  ON public.commissions FOR SELECT TO authenticated
  USING (
    agency_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- payouts
DROP POLICY IF EXISTS "payouts_select_owner_or_admin" ON public.payouts;
CREATE POLICY "payouts_select_owner_or_admin"
  ON public.payouts FOR SELECT TO authenticated
  USING (
    agency_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ─────────────────────────────────────────────────────────
-- 10) RPC: lookup_referral_link (anon)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_referral_link(p_code TEXT)
RETURNS TABLE(id UUID, is_active BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT id, is_active FROM public.referral_links WHERE code = p_code LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.lookup_referral_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_referral_link(TEXT) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────
-- 11) RPC: record_referral_click (anon でも /r/[code] route から呼べる)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_referral_click(
  p_link_id UUID,
  p_visitor_id TEXT,
  p_ip_hash TEXT,
  p_user_agent TEXT,
  p_referrer TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_click_id UUID;
BEGIN
  INSERT INTO public.referral_clicks
    (referral_link_id, visitor_id, ip_hash, user_agent, referrer)
    VALUES (p_link_id, p_visitor_id, p_ip_hash, p_user_agent, p_referrer)
    RETURNING id INTO v_click_id;

  UPDATE public.agencies a
    SET total_clicks = total_clicks + 1
    FROM public.referral_links rl
    WHERE rl.id = p_link_id AND a.user_id = rl.agency_user_id;

  RETURN v_click_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[record_referral_click] failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_referral_click(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_referral_click(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────
-- 12) handle_referral_attribution trigger
--     user_profiles INSERT AFTER → referrals 作成 + agencies の集計 + rank 同期
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_agency_rank(p_total_referrals INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_total_referrals >= 50 THEN 'diamond'
    WHEN p_total_referrals >= 20 THEN 'platinum'
    WHEN p_total_referrals >= 10 THEN 'gold'
    WHEN p_total_referrals >= 5  THEN 'silver'
    ELSE 'bronze'
  END;
$$;

CREATE OR REPLACE FUNCTION public.handle_referral_attribution()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_ref_code TEXT;
  v_link_id UUID;
  v_link_active BOOLEAN;
  v_agency_user_id UUID;
  v_referral_id UUID;
  v_new_total INTEGER;
BEGIN
  SELECT raw_user_meta_data->>'referral_code' INTO v_ref_code
    FROM auth.users WHERE id = NEW.id;

  IF v_ref_code IS NULL OR length(trim(v_ref_code)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT id, is_active, agency_user_id
    INTO v_link_id, v_link_active, v_agency_user_id
    FROM public.referral_links
    WHERE code = trim(v_ref_code)
    LIMIT 1;

  IF v_link_id IS NULL OR v_link_active = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.referrals (referral_link_id, referred_user_id, status)
    VALUES (v_link_id, NEW.id, 'signed_up')
    ON CONFLICT (referred_user_id) DO NOTHING
    RETURNING id INTO v_referral_id;

  IF v_referral_id IS NOT NULL THEN
    UPDATE public.agencies
      SET total_referrals = total_referrals + 1,
          current_rank = public.compute_agency_rank(total_referrals + 1)
      WHERE user_id = v_agency_user_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[handle_referral_attribution] failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_user_profiles_referral_attribution ON public.user_profiles;
CREATE TRIGGER tg_user_profiles_referral_attribution
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_referral_attribution();

-- ─────────────────────────────────────────────────────────
-- 13) COMMENTS
-- ─────────────────────────────────────────────────────────
COMMENT ON TABLE public.agencies IS
  '代理店本体。user_profiles と 1:1。status (pending/approved/suspended/rejected)・rank・集計値を保持';
COMMENT ON TABLE public.agency_applications IS
  '代理店申請履歴。pending は 1 user 1 件、approved/rejected は履歴として複数残せる';
COMMENT ON TABLE public.referral_links IS
  '代理店ごとに複数発行可能な紹介リンク。code は UNIQUE';
COMMENT ON TABLE public.referral_clicks IS
  '紹介リンクへのアクセス記録。1 clickper 1 row。IP は SHA-256 hash で保存';
COMMENT ON TABLE public.referrals IS
  '紹介済み (入会到達) ユーザー。1 user は 1 帰属のみ';
COMMENT ON TABLE public.commissions IS
  'コミッション発生履歴 (Stripe 統合時に運用開始予定)';
COMMENT ON TABLE public.payouts IS
  '出金履歴 (Stripe 統合時に運用開始予定)';

-- ─────────────────────────────────────────────────────────
-- 14) PostgREST schema cache reload
-- ─────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
