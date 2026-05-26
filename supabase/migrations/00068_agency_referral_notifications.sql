-- 00068_agency_referral_notifications.sql
-- 代理店向け紹介通知: 登録確認 + 初回課金
--
-- Feature 1: referral_signed_up — 紹介リンク経由ユーザーの登録完了時に代理店へ通知
-- Feature 2: referral_paying   — 紹介ユーザーの初回課金時に代理店へ通知
--
-- 設計判断:
--   * 通知は DB trigger / RPC 内で INSERT (TypeScript 層ではなく)。
--     理由: 状態遷移と通知が同一トランザクション。webhook handler が
--     RPC 後にクラッシュしても通知が消失しない。
--   * SECURITY DEFINER 関数は notifications テーブルへの INSERT を RLS バイパスで実行可能。
--   * 冪等性: 登録は ON CONFLICT DO NOTHING → v_referral_id IS NULL なら通知 skip。
--     課金は status='signed_up' 条件で初回遷移時のみ通知。

-- ─── 1) notification_type enum に 2 値追加 ───
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'referral_signed_up';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'referral_paying';

-- ─── 2) handle_referral_attribution: 登録通知を追加 ───
-- 既存ロジック (00063) を完全保持 + notification INSERT を追加
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

    -- 代理店に登録通知を送信
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
      v_agency_user_id,
      'referral_signed_up',
      '紹介ユーザーが登録しました',
      COALESCE(NEW.name, 'メンバー') || 'さんが登録確認できました',
      '/agency'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[handle_referral_attribution] failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ─── 3) handle_subscription_payment: 初回課金通知を追加 ───
-- 既存ロジック (00067) を完全保持 + notification INSERT を追加
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

    -- 代理店に課金通知を送信 (初回遷移時のみ)
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
