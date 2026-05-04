-- R2残ブロッカー対応:
-- 1. 第三者提供同意の永続化 (法27条の同意取得記録)
-- 2. complete_onboarding RPC に validation 強化 + context 互換維持
-- 3. /api/v1/goals/offerings 互換のため context カラムも更新

-- 1) user_profiles に同意記録カラム追加
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS contact_sharing_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_sharing_consent_version TEXT;

COMMENT ON COLUMN public.user_profiles.contact_sharing_consent_at IS
  'マッチング相手への連絡先(個情法27条第三者提供)同意取得時刻。 onboarding step1で取得。';

-- 2) complete_onboarding RPC を拡張: 同意永続化 + validation強化 + context互換
DROP FUNCTION IF EXISTS public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB);
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_user_id UUID,
  p_name TEXT,
  p_company TEXT,
  p_position TEXT,
  p_contact_info TEXT,
  p_goals JSONB,
  p_offerings JSONB,
  p_contact_sharing_consent BOOLEAN DEFAULT false,
  p_consent_version TEXT DEFAULT '2026-05-04'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  g JSONB;
  o JSONB;
  v_caller UUID := auth.uid();
  v_detail TEXT;
BEGIN
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'complete_onboarding: caller % cannot operate on user %', v_caller, p_user_id;
  END IF;

  IF jsonb_array_length(p_goals) < 1 OR jsonb_array_length(p_offerings) < 1 THEN
    RAISE EXCEPTION 'complete_onboarding: goals and offerings must each have >= 1 entry';
  END IF;

  -- 第三者提供同意は必須 (UI でも disable しているが server側でもガード)
  IF NOT p_contact_sharing_consent THEN
    RAISE EXCEPTION 'complete_onboarding: contact sharing consent is required';
  END IF;

  -- profile 更新 + 同意記録
  UPDATE public.user_profiles
     SET name = p_name,
         company = NULLIF(p_company, ''),
         position = NULLIF(p_position, ''),
         contact_info = NULLIF(p_contact_info, ''),
         contact_sharing_consent_at = COALESCE(contact_sharing_consent_at, now()),
         contact_sharing_consent_version = COALESCE(contact_sharing_consent_version, p_consent_version),
         updated_at = now()
   WHERE id = p_user_id;

  -- goals: detail と context 両方に書く (旧API/AI抽出パイプライン互換)
  DELETE FROM public.user_goals WHERE user_id = p_user_id;
  FOR g IN SELECT * FROM jsonb_array_elements(p_goals) LOOP
    v_detail := NULLIF(g->>'detail', '');
    -- detail が長すぎる場合は500文字に切り詰め
    IF v_detail IS NOT NULL AND length(v_detail) > 500 THEN
      v_detail := substring(v_detail, 1, 500);
    END IF;
    INSERT INTO public.user_goals (user_id, type, detail, context)
    VALUES (
      p_user_id,
      (g->>'type')::public.goal_type,
      v_detail,
      v_detail  -- context との互換維持。AI抽出パイプラインがcontextを読む間はミラー保存
    );
  END LOOP;

  DELETE FROM public.user_offerings WHERE user_id = p_user_id;
  FOR o IN SELECT * FROM jsonb_array_elements(p_offerings) LOOP
    v_detail := NULLIF(o->>'detail', '');
    IF v_detail IS NOT NULL AND length(v_detail) > 500 THEN
      v_detail := substring(v_detail, 1, 500);
    END IF;
    INSERT INTO public.user_offerings (user_id, type, detail, context)
    VALUES (
      p_user_id,
      (o->>'type')::public.goal_type,
      v_detail,
      v_detail
    );
  END LOOP;

  UPDATE public.user_profiles
     SET onboarding_step = 3
   WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION public.complete_onboarding IS
  'onboarding完了atomic処理 v2: profile + goals/offerings (detail/context同時) + onboarding_step=3 + 第三者提供同意記録 を1tx。';
