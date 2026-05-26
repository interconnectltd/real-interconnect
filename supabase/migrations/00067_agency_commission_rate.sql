-- 00067_agency_commission_rate.sql
--
-- Add a per-agency commission_rate column so each agency can have its own rate,
-- then update handle_subscription_payment to read from that column instead of
-- using a hardcoded 20%.

-- 1. Add the column
ALTER TABLE public.agencies
  ADD COLUMN commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.2000;

-- 2. Replace the RPC to use the per-agency rate
CREATE OR REPLACE FUNCTION public.handle_subscription_payment(
  p_user_id UUID,
  p_amount_jpy BIGINT,
  p_stripe_invoice_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral RECORD;
  v_rate NUMERIC(5,4);
BEGIN
  SELECT r.id, r.referral_link_id, rl.agency_user_id, r.status
    INTO v_referral
    FROM public.referrals r
    JOIN public.referral_links rl ON rl.id = r.referral_link_id
    WHERE r.referred_user_id = p_user_id;

  IF v_referral.id IS NULL THEN
    RETURN;
  END IF;

  -- Read the per-agency commission rate (falls back to 20%)
  SELECT COALESCE(a.commission_rate, 0.2000)
    INTO v_rate
    FROM public.agencies a
    WHERE a.user_id = v_referral.agency_user_id;

  IF v_rate IS NULL THEN
    v_rate := 0.2000;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.commissions
    WHERE referral_id = v_referral.id
      AND basis_jpy = p_amount_jpy
      AND created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;

  IF v_referral.status = 'signed_up' THEN
    UPDATE public.referrals
      SET status = 'paying',
          first_payment_at = COALESCE(first_payment_at, now())
      WHERE id = v_referral.id;
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

-- 3. Permissions
REVOKE ALL ON FUNCTION public.handle_subscription_payment(UUID, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_subscription_payment(UUID, BIGINT, TEXT) TO service_role;
