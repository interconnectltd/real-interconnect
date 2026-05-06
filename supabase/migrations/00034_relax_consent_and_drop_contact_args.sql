-- 00034: 連絡先入力 + 第三者提供同意の onboarding 必須化を撤廃
--
-- 設計判断:
--   - 旧 RPC は p_contact_info / p_contact_sharing_consent / p_consent_version を必須引数に取り、
--     consent=false で例外を投げていた。
--   - 新方針はアプリ内チャット + Google Meet 自動発行で完結し、連絡先交換 UI を撤去。
--   - DB の contact_info / contact_sharing_consent_at カラムは既存ユーザー保護のため残置。
--   - 新 RPC は引数を最小化し、connection_sharing_consent の RAISE を削除。
--
-- 互換性:
--   - 旧 signature の RPC は DROP (型不一致でフロントの古い build から呼ばれた場合は 404 で fail。
--     onboarding は SPA キャッシュ更新後のみ呼ばれるので影響軽微)。
--   - 既存の user_profiles レコードは更新しない (consent_at/version は保持)。

DROP FUNCTION IF EXISTS public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.complete_onboarding(UUID, TEXT, TEXT, TEXT, JSONB, JSONB);

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_user_id UUID,
  p_name TEXT,
  p_company TEXT,
  p_position TEXT,
  p_goals JSONB,
  p_offerings JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  g JSONB;
  o JSONB;
  v_caller UUID := auth.uid();
  v_detail TEXT;
  v_goal_types TEXT[];
  v_offer_types TEXT[];
BEGIN
  -- 認可 (caller 自身の onboarding のみ許可)
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'complete_onboarding: caller % cannot operate on user %', v_caller, p_user_id;
  END IF;

  -- 配列内の type を DISTINCT 化して UNIQUE(user_id, type) 違反を防ぐ
  SELECT array_agg(DISTINCT (elem->>'type'))
    INTO v_goal_types
    FROM jsonb_array_elements(p_goals) elem;
  SELECT array_agg(DISTINCT (elem->>'type'))
    INTO v_offer_types
    FROM jsonb_array_elements(p_offerings) elem;

  IF coalesce(array_length(v_goal_types, 1), 0) < 1
     OR coalesce(array_length(v_offer_types, 1), 0) < 1 THEN
    RAISE EXCEPTION 'complete_onboarding: goals and offerings must each have >= 1 unique entry';
  END IF;

  -- profile + onboarding_step 更新 (連絡先・consent には触れない)
  UPDATE public.user_profiles
     SET name = p_name,
         company = nullif(p_company, ''),
         position = nullif(p_position, ''),
         onboarding_step = 3,
         updated_at = now()
   WHERE id = p_user_id;

  -- goals: DISTINCT 化された type だけINSERT
  DELETE FROM public.user_goals WHERE user_id = p_user_id;
  FOR g IN SELECT * FROM jsonb_array_elements(p_goals) LOOP
    IF (g->>'type') = ANY(v_goal_types) THEN
      v_detail := nullif(g->>'detail', '');
      IF v_detail IS NOT NULL AND length(v_detail) > 500 THEN
        v_detail := substring(v_detail, 1, 500);
      END IF;
      INSERT INTO public.user_goals (user_id, type, detail, context)
      VALUES (
        p_user_id,
        (g->>'type')::public.goal_type,
        v_detail,
        v_detail
      )
      ON CONFLICT (user_id, type) DO UPDATE
        SET detail = EXCLUDED.detail,
            context = EXCLUDED.context;
    END IF;
  END LOOP;

  DELETE FROM public.user_offerings WHERE user_id = p_user_id;
  FOR o IN SELECT * FROM jsonb_array_elements(p_offerings) LOOP
    IF (o->>'type') = ANY(v_offer_types) THEN
      v_detail := nullif(o->>'detail', '');
      IF v_detail IS NOT NULL AND length(v_detail) > 500 THEN
        v_detail := substring(v_detail, 1, 500);
      END IF;
      INSERT INTO public.user_offerings (user_id, type, detail, context)
      VALUES (
        p_user_id,
        (o->>'type')::public.goal_type,
        v_detail,
        v_detail
      )
      ON CONFLICT (user_id, type) DO UPDATE
        SET detail = EXCLUDED.detail,
            context = EXCLUDED.context;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
