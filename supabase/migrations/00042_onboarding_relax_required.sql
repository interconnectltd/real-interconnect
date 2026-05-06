-- 00042: complete_onboarding RPC で goals + offerings の最低件数要件を緩和
--
-- 経緯:
--   旧: goals ≥ 1 件 AND offerings ≥ 1 件 必須 (両方ゼロ件で 400 EXCEPTION)
--   問題: 「自分は受け取る側 (求めるだけ)」「提供する側 (offerings のみ)」の
--        ユーザーをブロック → 完了率が落ちる (UX audit /onboarding Critical#3)
--
-- 新仕様:
--   goals + offerings の合計が ≥ 1 件 でも進める。両方ゼロ件のみ拒否。
--   AI マッチング側は goals[]/offerings[] が空配列でも正常動作するため安全。

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
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'complete_onboarding: caller % cannot operate on user %', v_caller, p_user_id;
  END IF;

  SELECT array_agg(DISTINCT (elem->>'type'))
    INTO v_goal_types
    FROM jsonb_array_elements(p_goals) elem;
  SELECT array_agg(DISTINCT (elem->>'type'))
    INTO v_offer_types
    FROM jsonb_array_elements(p_offerings) elem;

  -- 緩和: 合計 1 件以上であれば OK (goals / offerings どちらか片側のみでも可)
  IF coalesce(array_length(v_goal_types, 1), 0)
     + coalesce(array_length(v_offer_types, 1), 0) < 1 THEN
    RAISE EXCEPTION 'complete_onboarding: goals + offerings must have >= 1 unique entry total';
  END IF;

  UPDATE public.user_profiles
     SET name = p_name,
         company = nullif(p_company, ''),
         position = nullif(p_position, ''),
         onboarding_step = 3,
         updated_at = now()
   WHERE id = p_user_id;

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
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, JSONB, JSONB)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
