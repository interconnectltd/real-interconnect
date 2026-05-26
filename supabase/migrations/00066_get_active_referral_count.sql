-- 累計アクティブ数: 代理店が紹介したユーザーのうち直近1ヶ月以内にログインしたユーザー数
-- auth.users.last_sign_in_at を参照するため SECURITY DEFINER が必要

CREATE OR REPLACE FUNCTION public.get_active_referral_count(p_agency_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_agency_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM public.referrals r
    JOIN public.referral_links rl ON rl.id = r.referral_link_id
    JOIN auth.users au ON au.id = r.referred_user_id
    WHERE rl.agency_user_id = p_agency_user_id
      AND au.last_sign_in_at >= now() - interval '1 month'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_referral_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_referral_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_referral_count(UUID) TO service_role;
