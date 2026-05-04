-- onboarding完了をトランザクション化 (R1指摘 H3/H4/M9 解消)
-- + legacy enum値の互換マッピング + detailカラム永続化前提のRPC

-- 1) legacy goal_type 値の互換: 古い'investment'は'investment_seek'にマップ
--    既存ユーザーの user_goals/offerings.type='investment' を 'investment_seek' へ移行
--    EXCEPTION 握り潰しは removed (致命エラーは migration 全停止する設計)
UPDATE public.user_goals
   SET type = 'investment_seek'::public.goal_type
 WHERE type::text = 'investment';
UPDATE public.user_offerings
   SET type = 'investment_offer'::public.goal_type
 WHERE type::text = 'investment';

-- 2) onboarding完了の atomic RPC (profile + goals + offerings + step=3 を1tx)
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_user_id UUID,
  p_name TEXT,
  p_company TEXT,
  p_position TEXT,
  p_contact_info TEXT,
  p_goals JSONB,       -- [{ "type": "client_intro", "detail": "..." }, ...]
  p_offerings JSONB    -- 同上
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
BEGIN
  -- 認証ユーザー本人のみ操作可
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'complete_onboarding: caller % cannot operate on user %', v_caller, p_user_id;
  END IF;

  -- goals/offerings は最低1件必須 (RLSで通せても整合性ガード)
  IF jsonb_array_length(p_goals) < 1 OR jsonb_array_length(p_offerings) < 1 THEN
    RAISE EXCEPTION 'complete_onboarding: goals and offerings must each have >= 1 entry';
  END IF;

  -- profile 更新 (onboarding_step=3 を最後に上げる)
  UPDATE public.user_profiles
     SET name = p_name,
         company = NULLIF(p_company, ''),
         position = NULLIF(p_position, ''),
         contact_info = NULLIF(p_contact_info, ''),
         updated_at = now()
   WHERE id = p_user_id;

  -- goals: 既存全削除→新規挿入 (同一tx内なのでpartial failure無し)
  DELETE FROM public.user_goals WHERE user_id = p_user_id;
  FOR g IN SELECT * FROM jsonb_array_elements(p_goals) LOOP
    INSERT INTO public.user_goals (user_id, type, detail)
    VALUES (
      p_user_id,
      (g->>'type')::public.goal_type,
      NULLIF(g->>'detail', '')
    );
  END LOOP;

  -- offerings: 同上
  DELETE FROM public.user_offerings WHERE user_id = p_user_id;
  FOR o IN SELECT * FROM jsonb_array_elements(p_offerings) LOOP
    INSERT INTO public.user_offerings (user_id, type, detail)
    VALUES (
      p_user_id,
      (o->>'type')::public.goal_type,
      NULLIF(o->>'detail', '')
    );
  END LOOP;

  -- onboarding_step を最後に 3 へ昇格 (途中失敗でロックされない設計)
  UPDATE public.user_profiles
     SET onboarding_step = 3
   WHERE id = p_user_id;
END;
$$;

-- 認証済ユーザー本人のみ実行可
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.complete_onboarding IS
  'onboarding完了の単一tx処理。profile更新+goals/offerings replace+step=3を atomic に実行。
  partial failure 時は全rollbackで「永久ロック」状態を防ぐ。';
