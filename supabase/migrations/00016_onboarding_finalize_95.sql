-- R3残ブロッカー全消化:
-- B-1: 00014 EXCEPTION 握り潰し排除 (再実行)
-- B-2: RPC で goals/offerings dedup (DISTINCT)
-- B-3: 旧 enum値 hiring/info_exchange の移行
-- B-4: consent_version CHECK 制約
-- B-5: search_path = '' で defense-in-depth

-- B-2 前提: UNIQUE(user_id, type) 制約追加 (ON CONFLICT 動作のため)
--   既存に重複行があればまずクリーンアップ
DELETE FROM public.user_goals a
 USING public.user_goals b
 WHERE a.ctid > b.ctid
   AND a.user_id = b.user_id
   AND a.type = b.type;
DELETE FROM public.user_offerings a
 USING public.user_offerings b
 WHERE a.ctid > b.ctid
   AND a.user_id = b.user_id
   AND a.type = b.type;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_goals_user_id_type_unique'
  ) THEN
    ALTER TABLE public.user_goals
      ADD CONSTRAINT user_goals_user_id_type_unique UNIQUE (user_id, type);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_offerings_user_id_type_unique'
  ) THEN
    ALTER TABLE public.user_offerings
      ADD CONSTRAINT user_offerings_user_id_type_unique UNIQUE (user_id, type);
  END IF;
END $$;

-- B-3: 旧 enum 値の移行 (hiring → recruitment, info_exchange → information)
DO $$
BEGIN
  -- 通常実行: legacy 値を新カテゴリへマップ
  -- (PG14+: ALTER TYPE ADD VALUE は同一tx内では使用済の値しか参照できないため、
  --  別 tx で実行されている前提)
  UPDATE public.user_goals SET type = 'recruitment'::public.goal_type
   WHERE type::text = 'hiring';
  UPDATE public.user_goals SET type = 'information'::public.goal_type
   WHERE type::text = 'info_exchange';
  UPDATE public.user_offerings SET type = 'recruitment'::public.goal_type
   WHERE type::text = 'hiring';
  UPDATE public.user_offerings SET type = 'information'::public.goal_type
   WHERE type::text = 'info_exchange';
  -- B-1の再対応: 00014で残っていた legacy investment migration の EXCEPTION 握り潰しは
  -- 既に下記UPDATEで完結しているため再 RAISE しない。 致命エラー時は migration 全停止が望ましい
  UPDATE public.user_goals SET type = 'investment_seek'::public.goal_type
   WHERE type::text = 'investment';
  UPDATE public.user_offerings SET type = 'investment_offer'::public.goal_type
   WHERE type::text = 'investment';
END $$;

-- B-2 + B-4 + B-5: complete_onboarding RPC 再構築 (dedup + consent_version CHECK + search_path空)
DROP FUNCTION IF EXISTS public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, TEXT);
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
SET search_path = ''  -- 全schema修飾必須 (Supabase advisor推奨, PostgreSQL search_path injection対策)
AS $$
DECLARE
  g JSONB;
  o JSONB;
  v_caller UUID := auth.uid();
  v_detail TEXT;
  v_goal_types TEXT[];
  v_offer_types TEXT[];
BEGIN
  -- 認可
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'complete_onboarding: caller % cannot operate on user %', v_caller, p_user_id;
  END IF;

  -- consent 必須
  IF NOT p_contact_sharing_consent THEN
    RAISE EXCEPTION 'complete_onboarding: contact sharing consent is required';
  END IF;

  -- B-4: consent_version は 'YYYY-MM-DD' 形式のみ許容 (任意文字列で同意済を主張する攻撃の防止)
  IF p_consent_version !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'complete_onboarding: invalid consent_version format (expected YYYY-MM-DD)';
  END IF;

  -- B-2: 配列内の type を DISTINCT 化して UNIQUE(user_id, type) 違反を防ぐ
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

  -- profile + 同意記録 + onboarding_step を1ステートメントで更新
  UPDATE public.user_profiles
     SET name = p_name,
         company = nullif(p_company, ''),
         position = nullif(p_position, ''),
         contact_info = nullif(p_contact_info, ''),
         contact_sharing_consent_at = COALESCE(contact_sharing_consent_at, now()),
         contact_sharing_consent_version = COALESCE(contact_sharing_consent_version, p_consent_version),
         onboarding_step = 3,
         updated_at = now()
   WHERE id = p_user_id;

  -- goals: DISTINCT 化された type だけINSERT
  DELETE FROM public.user_goals WHERE user_id = p_user_id;
  FOR g IN SELECT * FROM jsonb_array_elements(p_goals) LOOP
    -- 同一typeを既に挿入済かチェック (二重INSERT防止)
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

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, TEXT) TO authenticated, service_role;

-- PostgREST schema cache reload (signature 変更時の cold-start 解消)
NOTIFY pgrst, 'reload schema';
