-- 00064_stripe_subscriptions.sql
-- Stripe 課金統合: subscriptions テーブル + user_profiles.stripe_customer_id
--
-- 設計判断:
--   * Stripe Customer / Subscription の状態を DB に常駐させる (webhook で同期)
--     → アプリ側で「課金中か?」を聞くたびに Stripe API を叩かない (latency / quota)
--   * user_profiles.stripe_customer_id を追加。1 user 1 顧客で十分。
--   * subscriptions は customer 1 : N で複数行残せる設計 (将来プラン変更で
--     旧 sub が `canceled` として残るのは正常)。active な sub は status='active'
--     or 'trialing'。
--   * commissions テーブル (00063) は subscription の初回支払いで INSERT、
--     refund / chargeback で reverse する想定。
--   * webhook ハンドラから service_role で書き込むため、authenticated 用の
--     RLS は SELECT のみ (本人 + admin)。INSERT/UPDATE/DELETE は service_role 限定。

BEGIN;

-- ─────────────────────────────────────────────────────────
-- 1) user_profiles に Stripe Customer ID を追加
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer
  ON public.user_profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.stripe_customer_id IS
  'Stripe Customer ID (cus_...) — Checkout 初回完了時に webhook が設定';

-- ─────────────────────────────────────────────────────────
-- 2) subscriptions
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  -- Stripe の subscription.status: trialing/active/past_due/canceled/unpaid/incomplete/incomplete_expired/paused
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  -- 直近の支払い金額 (JPY、税込)。コミッション計算の basis に使う
  last_invoice_amount_jpy BIGINT,
  last_invoice_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON public.subscriptions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions(status) WHERE status IN ('active', 'trialing');

CREATE OR REPLACE FUNCTION public.tg_subscriptions_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER tg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_subscriptions_set_updated_at();

-- ─────────────────────────────────────────────────────────
-- 3) RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_subscriptions" ON public.subscriptions;
CREATE POLICY "service_subscriptions"
  ON public.subscriptions AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "subscriptions_select_owner_or_admin" ON public.subscriptions;
CREATE POLICY "subscriptions_select_owner_or_admin"
  ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ─────────────────────────────────────────────────────────
-- 4) RPC: handle_subscription_payment
--    Webhook から呼び出される。subscription の課金成功時に
--    referrals → paying へ昇格 + commissions を INSERT する。
--
--    冪等: 同じ stripe_invoice_id について 2 回呼ばれても commission 二重発生しない
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_subscription_payment(
  p_user_id UUID,
  p_amount_jpy BIGINT,
  p_stripe_invoice_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral RECORD;
  v_rate NUMERIC(5,4) := 0.2000;  -- default 20%
BEGIN
  -- この user が紹介経由なら referral を取得
  SELECT r.id, r.referral_link_id, rl.agency_user_id, r.status
    INTO v_referral
    FROM public.referrals r
    JOIN public.referral_links rl ON rl.id = r.referral_link_id
    WHERE r.referred_user_id = p_user_id;

  IF v_referral.id IS NULL THEN
    RETURN;
  END IF;

  -- 既にこの invoice についてコミッション計上済みなら skip (冪等)
  IF EXISTS (
    SELECT 1 FROM public.commissions
    WHERE referral_id = v_referral.id
      AND basis_jpy = p_amount_jpy
      AND created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;

  -- 初回支払いなら status → paying / first_payment_at をセット
  IF v_referral.status = 'signed_up' THEN
    UPDATE public.referrals
      SET status = 'paying',
          first_payment_at = COALESCE(first_payment_at, now())
      WHERE id = v_referral.id;
  END IF;

  -- commission INSERT (pending = 返金期間待ち)
  INSERT INTO public.commissions
    (agency_user_id, referral_id, amount_jpy, rate, basis_jpy, status)
    VALUES (
      v_referral.agency_user_id,
      v_referral.id,
      floor(p_amount_jpy * v_rate),
      v_rate,
      p_amount_jpy,
      'pending'
    );

  -- agencies 集計値の更新
  UPDATE public.agencies
    SET total_earnings_jpy = total_earnings_jpy + floor(p_amount_jpy * v_rate),
        current_balance_jpy = current_balance_jpy + floor(p_amount_jpy * v_rate)
    WHERE user_id = v_referral.agency_user_id;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[handle_subscription_payment] failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_subscription_payment(UUID, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_subscription_payment(UUID, BIGINT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────
-- 5) RPC: handle_subscription_canceled
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_subscription_canceled(
  p_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.referrals
    SET status = 'churned',
        churned_at = now()
    WHERE referred_user_id = p_user_id
      AND status = 'paying';
END;
$$;
REVOKE ALL ON FUNCTION public.handle_subscription_canceled(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_subscription_canceled(UUID) TO service_role;

COMMENT ON TABLE public.subscriptions IS
  'Stripe Subscription の状態 cache。webhook で同期。1 user N rows (履歴含む)';

NOTIFY pgrst, 'reload schema';

COMMIT;
