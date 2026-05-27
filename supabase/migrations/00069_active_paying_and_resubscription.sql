-- 00069_active_paying_and_resubscription.sql
--
-- 3つの修正:
--   1. get_active_referral_count をログイン基準→課金基準に置換
--   2. handle_subscription_payment に churned/refunded → paying 再遷移を追加
--   3. 再加入時に代理店へ通知 (referral_resubscribed)
--
-- 設計判断:
--   * 「アクティブ」= referrals.status='paying' AND subscriptions.status IN ('active','trialing')
--     AND current_period_end >= now()
--   * 再加入時は churned_at/refunded_at を NULL にリセット
--   * コミッションは invoice.payment_succeeded ごとに発生（Stripe が課金成功を保証）

-- ─── 1) notification_type に再加入通知を追加 ───
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'referral_resubscribed';

-- ─── 2) パフォーマンス用インデックス ───
CREATE INDEX IF NOT EXISTS idx_referrals_status_user
  ON public.referrals(status, referred_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON public.subscriptions(user_id, status, current_period_end DESC);

-- ─── 3) get_active_referral_count: ログイン基準→課金基準に置換 ───
CREATE OR REPLACE FUNCTION public.get_active_referral_count(p_agency_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_agency_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN (
    SELECT COUNT(DISTINCT r.id)::INTEGER
    FROM public.referrals r
    JOIN public.referral_links rl ON rl.id = r.referral_link_id
    JOIN public.subscriptions s ON s.user_id = r.referred_user_id
    WHERE rl.agency_user_id = p_agency_user_id
      AND r.status = 'paying'
      AND s.status IN ('active', 'trialing')
      AND s.current_period_end >= now()
  );
END;
$$;

-- ─── 4) handle_subscription_payment: 再加入対応 + 通知 ───
CREATE OR REPLACE FUNCTION public.handle_subscription_payment(
  p_user_id UUID,
  p_amount_jpy BIGINT,
  p_stripe_invoice_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral RECORD;
  v_rate NUMERIC(5,4);
  v_user_name TEXT;
BEGIN
  SELECT r.id, r.referral_link_id, rl.agency_user_id, r.status
    INTO v_referral
    FROM public.referrals r
    JOIN public.referral_links rl ON rl.id = r.referral_link_id
    WHERE r.referred_user_id = p_user_id;

  IF v_referral.id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(a.commission_rate, 0.2000)
    INTO v_rate
    FROM public.agencies a
    WHERE a.user_id = v_referral.agency_user_id;

  IF v_rate IS NULL THEN
    v_rate := 0.2000;
  END IF;

  -- 冪等性チェック (金額 + 1時間窓)
  IF EXISTS (
    SELECT 1 FROM public.commissions
    WHERE referral_id = v_referral.id
      AND basis_jpy = p_amount_jpy
      AND created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;

  -- 初回課金: signed_up → paying
  IF v_referral.status = 'signed_up' THEN
    UPDATE public.referrals
      SET status = 'paying',
          first_payment_at = COALESCE(first_payment_at, now())
      WHERE id = v_referral.id;

    SELECT name INTO v_user_name
      FROM public.user_profiles WHERE id = p_user_id;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
      v_referral.agency_user_id,
      'referral_paying',
      '紹介ユーザーが課金しました',
      COALESCE(v_user_name, 'ユーザー') || 'さんが課金しました',
      '/agency'
    );

  -- 再加入: churned/refunded → paying
  ELSIF v_referral.status IN ('churned', 'refunded') THEN
    UPDATE public.referrals
      SET status = 'paying',
          churned_at = NULL,
          refunded_at = NULL
      WHERE id = v_referral.id;

    SELECT name INTO v_user_name
      FROM public.user_profiles WHERE id = p_user_id;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
      v_referral.agency_user_id,
      'referral_resubscribed',
      '紹介ユーザーが再加入しました',
      COALESCE(v_user_name, 'ユーザー') || 'さんが再加入しました',
      '/agency'
    );
  END IF;

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

  UPDATE public.agencies
    SET total_earnings_jpy = total_earnings_jpy + floor(p_amount_jpy * v_rate),
        current_balance_jpy = current_balance_jpy + floor(p_amount_jpy * v_rate)
    WHERE user_id = v_referral.agency_user_id;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[handle_subscription_payment] failed: %', SQLERRM;
END;
$$;

-- ─── 5) 権限を明示的に再宣言 (CREATE OR REPLACE で暗黙保持されるが安全策) ───
REVOKE ALL ON FUNCTION public.get_active_referral_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_referral_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_referral_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.handle_subscription_payment(UUID, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_subscription_payment(UUID, BIGINT, TEXT) TO service_role;
