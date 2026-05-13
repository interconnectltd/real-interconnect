-- 00059: P0-1 fix — member_ai_profiles_v2 の cross-user read leak を解消
--
-- 真因:
--   00001:446-447 の "authenticated_view_ai_profiles" policy が
--     USING (auth.role() = 'authenticated')
--   と user_id を見ない条件で、任意の認証ユーザーが needs を含む全 row を
--   SELECT * できる privacy leak だった。
--
-- 修正方針:
--   sibling テーブル (settings / user_terms_acceptances / user_goals /
--   user_offerings / matching_scores_v4 等) と同じ
--   own + admin + service_role モデルに揃える。
--   cross-user 読出は get_public_ai_profiles RPC (SECURITY DEFINER /
--   needs strip 済) 経由に集約。

DROP POLICY IF EXISTS "authenticated_view_ai_profiles" ON public.member_ai_profiles_v2;
DROP POLICY IF EXISTS "own_ai_profile_select"          ON public.member_ai_profiles_v2;
DROP POLICY IF EXISTS "admin_ai_profile_select"        ON public.member_ai_profiles_v2;
DROP POLICY IF EXISTS "service_role_ai_profiles_full"  ON public.member_ai_profiles_v2;

ALTER TABLE public.member_ai_profiles_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_ai_profile_select"
  ON public.member_ai_profiles_v2
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admin_ai_profile_select"
  ON public.member_ai_profiles_v2
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "service_role_ai_profiles_full"
  ON public.member_ai_profiles_v2
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
