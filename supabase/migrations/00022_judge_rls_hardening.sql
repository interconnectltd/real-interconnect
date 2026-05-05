-- 00022_judge_rls_hardening.sql
--
-- P3 セキュリティ pen-test の HIGH 指摘の修正:
--   1) judge_pair_cache.service_judge_pair_cache policy が roles={public}
--      で cmd=ALL/qual=true → authenticated 全件読み書き可能 (IDOR + 任意書込)。
--   2) judge_quota_log.service_judge_quota_log も同じ脆弱性。
--   3) match_pair_embeddings RPC の SET search_path に pg_temp が無い。
--   4) viewer_read_own_judge_pair_cache が roles={public} (本来 authenticated のみで足りる)。
--
-- 修正方針:
--   - service policy → TO service_role に厳格化
--   - viewer_read_own → TO authenticated に明示
--   - target 側からも自分のペアを見たいケース (双方向 UI) を考慮し
--     auth.uid() = viewer_id OR auth.uid() = target_id を許可
--   - RPC search_path に pg_temp 追記

-- ────────────────────────────────────────
-- 1) judge_pair_cache RLS 厳格化
-- ────────────────────────────────────────
DROP POLICY IF EXISTS "service_judge_pair_cache" ON public.judge_pair_cache;
DROP POLICY IF EXISTS "viewer_read_own_judge_pair_cache" ON public.judge_pair_cache;

CREATE POLICY "service_role_judge_pair_cache_full"
  ON public.judge_pair_cache
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 認証ユーザーは自分が viewer または target の行のみ SELECT 可
CREATE POLICY "auth_select_judge_pair_cache"
  ON public.judge_pair_cache
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (auth.uid() = viewer_id OR auth.uid() = target_id);

-- ────────────────────────────────────────
-- 2) judge_quota_log RLS 厳格化 (service_role 専用)
-- ────────────────────────────────────────
DROP POLICY IF EXISTS "service_judge_quota_log" ON public.judge_quota_log;

CREATE POLICY "service_role_judge_quota_log_full"
  ON public.judge_quota_log
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 自分の quota 消費状況だけ閲覧可 (将来 settings 画面で使う)
CREATE POLICY "auth_select_own_judge_quota_log"
  ON public.judge_quota_log
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (auth.uid() = viewer_id);

-- ────────────────────────────────────────
-- 3) match_pair_embeddings RPC 再定義 (search_path に pg_temp 追加)
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_pair_embeddings(
  p_viewer_id UUID,
  p_target_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_no FLOAT := 0;
  v_rv FLOAT := 0;
  v_topic FLOAT := 0;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_viewer_id THEN
    RAISE EXCEPTION 'forbidden: caller must equal p_viewer_id';
  END IF;

  IF p_viewer_id = p_target_id THEN
    RETURN jsonb_build_object('semantic_no', 0, 'semantic_rv', 0, 'semantic_topic', 0);
  END IF;

  SELECT COALESCE(MAX(1 - (n.embedding <=> o.embedding)), 0)
    INTO v_no
    FROM public.need_embeddings n
    JOIN public.offer_embeddings o ON true
   WHERE n.user_id = p_viewer_id
     AND o.user_id = p_target_id;

  SELECT COALESCE(MAX(1 - (n.embedding <=> o.embedding)), 0)
    INTO v_rv
    FROM public.need_embeddings n
    JOIN public.offer_embeddings o ON true
   WHERE n.user_id = p_target_id
     AND o.user_id = p_viewer_id;

  SELECT COALESCE(MAX(1 - (a.embedding <=> b.embedding)), 0)
    INTO v_topic
    FROM public.topic_embeddings a
    JOIN public.topic_embeddings b ON true
   WHERE a.user_id = p_viewer_id
     AND b.user_id = p_target_id;

  RETURN jsonb_build_object(
    'semantic_no',    GREATEST(0, LEAST(1, v_no)),
    'semantic_rv',    GREATEST(0, LEAST(1, v_rv)),
    'semantic_topic', GREATEST(0, LEAST(1, v_topic))
  );
END;
$$;
