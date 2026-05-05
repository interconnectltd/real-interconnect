-- 00019_pair_matching_security.sql
--
-- 監査人 D (Sec) + E (Perf) で発見した重大 RLS 問題を修正。
--
-- 1) matching_scores_v4 の "service_scores_v4" policy は TO service_role 句が無く
--    PERMISSIVE 結合で **authenticated でも全件 SELECT 可能** だった。
-- 2) user_goals / user_offerings の SELECT policy も `auth.role()='authenticated'`
--    だけで全件読めていた → IDOR で他ユーザーの事業希望を全列挙可能。
-- 3) (viewer_id, target_id) 複合 index 不在で /pair endpoint が seq scan。
-- 4) /pair で他人の score (target_id=auth.uid() 行) を読む正当な経路がない
--    → SECURITY DEFINER RPC `get_pair_matching` を新設し、双方向 score を
--    auth.uid() に対する関係 (viewer or target) のみ返す。

-- ────────────────────────────────────────
-- 1) matching_scores_v4 RLS 厳格化
-- ────────────────────────────────────────
DROP POLICY IF EXISTS "service_scores_v4" ON public.matching_scores_v4;
DROP POLICY IF EXISTS "viewer_scores_v4" ON public.matching_scores_v4;

-- service_role 専用 (compute job 用)
CREATE POLICY "service_role_full_v4"
  ON public.matching_scores_v4
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 認証ユーザーは自分が viewer または target の行のみ SELECT 可
-- (双方向 pair 表示のため target_id 経由も許可)
CREATE POLICY "authenticated_select_v4"
  ON public.matching_scores_v4
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = viewer_id OR auth.uid() = target_id);

-- ────────────────────────────────────────
-- 2) (viewer_id, target_id) 複合 index 追加
-- ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_v4_viewer_target
  ON public.matching_scores_v4(viewer_id, target_id)
  INCLUDE (total_score, score_reasons, confidence, phase);

CREATE INDEX IF NOT EXISTS idx_v4_target_viewer
  ON public.matching_scores_v4(target_id, viewer_id)
  INCLUDE (total_score, score_reasons, confidence, phase);

-- ────────────────────────────────────────
-- 3) user_goals / user_offerings RLS 引き締め
-- ────────────────────────────────────────
DO $$
BEGIN
  -- 既存 policy を確認・置換
  EXECUTE 'DROP POLICY IF EXISTS "authenticated_view_goals" ON public.user_goals';
  EXECUTE 'DROP POLICY IF EXISTS "authenticated_view_offerings" ON public.user_offerings';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'old goals/offerings policy drop skipped: %', SQLERRM;
END $$;

-- 自分の goals/offerings は本人のみ閲覧
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_goals' AND policyname='user_goals_own_select'
  ) THEN
    CREATE POLICY "user_goals_own_select"
      ON public.user_goals
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_offerings' AND policyname='user_offerings_own_select'
  ) THEN
    CREATE POLICY "user_offerings_own_select"
      ON public.user_offerings
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ────────────────────────────────────────
-- 4) get_pair_matching RPC: 自分と相手の双方向分析を atomic に返す
--    SECURITY DEFINER で安全に他人の goals/offerings/score を計算統合
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pair_matching(p_target_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_target_profile JSONB;
  v_my_score RECORD;
  v_their_score RECORD;
  v_my_found BOOLEAN := FALSE;
  v_their_found BOOLEAN := FALSE;
  v_my_goals TEXT[];
  v_my_offerings TEXT[];
  v_their_goals TEXT[];
  v_their_offerings TEXT[];
  v_my_want_they_have TEXT[];
  v_i_offer_they_want TEXT[];
  v_threshold REAL := 0.70;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF v_caller = p_target_id THEN
    RAISE EXCEPTION 'cannot fetch pair against self';
  END IF;

  -- target profile (退会済 / 非アクティブを除外)
  SELECT to_jsonb(p) INTO v_target_profile
  FROM (
    SELECT id, name, company, position, industry, bio, avatar_url
    FROM public.user_profiles
    WHERE id = p_target_id AND is_active = true
  ) p;

  IF v_target_profile IS NULL THEN
    -- 存在しない / 非アクティブは 200 + null で user enumeration 防止
    RETURN jsonb_build_object(
      'target_profile', NULL,
      'my_score', 0,
      'their_score', 0,
      'is_mutual', FALSE,
      'my_reasons', '[]'::jsonb,
      'their_reasons', '[]'::jsonb,
      'common_topics', jsonb_build_object(
        'my_want_they_have', '[]'::jsonb,
        'i_offer_they_want', '[]'::jsonb
      ),
      'needs_compute', TRUE,
      'their_missing', TRUE
    );
  END IF;

  -- 自分→相手 score
  SELECT total_score, score_reasons, confidence, phase
    INTO v_my_score
    FROM public.matching_scores_v4
   WHERE viewer_id = v_caller AND target_id = p_target_id;
  v_my_found := FOUND;

  -- 相手→自分 score
  SELECT total_score, score_reasons, confidence, phase
    INTO v_their_score
    FROM public.matching_scores_v4
   WHERE viewer_id = p_target_id AND target_id = v_caller;
  v_their_found := FOUND;

  -- goals / offerings (双方の type だけ集計、detail は表示しない)
  SELECT array_agg(type::text) INTO v_my_goals FROM public.user_goals WHERE user_id = v_caller;
  SELECT array_agg(type::text) INTO v_their_goals FROM public.user_goals WHERE user_id = p_target_id;
  SELECT array_agg(type::text) INTO v_my_offerings FROM public.user_offerings WHERE user_id = v_caller;
  SELECT array_agg(type::text) INTO v_their_offerings FROM public.user_offerings WHERE user_id = p_target_id;

  -- 共通領域 (set INTERSECT)
  SELECT array_agg(t) INTO v_my_want_they_have
    FROM unnest(coalesce(v_my_goals, '{}')) t
   WHERE t = ANY (coalesce(v_their_offerings, '{}'));
  SELECT array_agg(t) INTO v_i_offer_they_want
    FROM unnest(coalesce(v_my_offerings, '{}')) t
   WHERE t = ANY (coalesce(v_their_goals, '{}'));

  RETURN jsonb_build_object(
    'target_profile', v_target_profile,
    'my_score', coalesce(v_my_score.total_score, 0),
    'their_score', coalesce(v_their_score.total_score, 0),
    'is_mutual',
      coalesce(v_my_score.total_score, 0) >= v_threshold AND
      coalesce(v_their_score.total_score, 0) >= v_threshold,
    'my_reasons', coalesce(to_jsonb(v_my_score.score_reasons), '[]'::jsonb),
    'their_reasons', coalesce(to_jsonb(v_their_score.score_reasons), '[]'::jsonb),
    'my_confidence', v_my_score.confidence,
    'phase', coalesce(v_my_score.phase::text, 'attribute_only'),
    'common_topics', jsonb_build_object(
      'my_want_they_have', coalesce(to_jsonb(v_my_want_they_have), '[]'::jsonb),
      'i_offer_they_want', coalesce(to_jsonb(v_i_offer_they_want), '[]'::jsonb)
    ),
    -- needs_compute は自分→相手のスコアが無い場合のみ true (Persona A 指摘)
    'needs_compute', NOT v_my_found,
    -- their_missing は相手→自分が無い時 (= 双方向分析が片側だけ)
    'their_missing', NOT v_their_found
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_pair_matching(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pair_matching(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_pair_matching IS
  'auth.uid() と p_target_id の双方向マッチング情報を atomic に返す。
   security definer で他人の goals/offerings type だけ抽出 (detail は隠蔽)、
   user_profiles.is_active=true のみ。RLS 厳格化との両立用。';
