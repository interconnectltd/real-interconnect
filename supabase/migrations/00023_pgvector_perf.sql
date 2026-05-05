-- 00023_pgvector_perf.sql
--
-- P4 perf-audit の致命的指摘の修正:
--
-- 1) compute-v2/route.ts が Promise.all(targetIds.map(applyEmbeddingScore)) で
--    1k ユーザーで 999 RPC = 8-15 秒の N RTT 暴発。
--    → match_pair_embeddings_batch を新設し 1 RTT で全 target をまとめて返す。
--
-- 2) HNSW index は EXPLAIN ANALYZE で実証的に「使われない」(user_id 事前フィルタ
--    後の cross-join では plan は B-tree のみ)。書込コストだけ被るので drop。
--    将来 "全ユーザー横断 top-K 類似 offer 検索" が必要になったら 1 つだけ復活。

-- ────────────────────────────────────────
-- 1) HNSW index drop (使われていないが書込コストかかる)
-- ────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_need_embeddings_hnsw;
DROP INDEX IF EXISTS public.idx_offer_embeddings_hnsw;
DROP INDEX IF EXISTS public.idx_topic_embeddings_hnsw;

-- ────────────────────────────────────────
-- 2) batch RPC: 1 viewer × N targets を atomic に返す
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_pair_embeddings_batch(
  p_viewer_id  UUID,
  p_target_ids UUID[]
)
RETURNS TABLE (
  target_id      UUID,
  semantic_no    FLOAT,
  semantic_rv    FLOAT,
  semantic_topic FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_viewer_id THEN
    RAISE EXCEPTION 'forbidden: caller must equal p_viewer_id';
  END IF;
  IF p_target_ids IS NULL OR array_length(p_target_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT t::uuid AS tid FROM unnest(p_target_ids) t WHERE t::uuid <> p_viewer_id
  ),
  fwd AS (
    SELECT t.tid AS tid,
           COALESCE(MAX(1 - (n.embedding <=> o.embedding)), 0) AS s
      FROM targets t
      LEFT JOIN public.need_embeddings n ON n.user_id = p_viewer_id
      LEFT JOIN public.offer_embeddings o ON o.user_id = t.tid
     GROUP BY t.tid
  ),
  rev AS (
    SELECT t.tid AS tid,
           COALESCE(MAX(1 - (n.embedding <=> o.embedding)), 0) AS s
      FROM targets t
      LEFT JOIN public.need_embeddings n ON n.user_id = t.tid
      LEFT JOIN public.offer_embeddings o ON o.user_id = p_viewer_id
     GROUP BY t.tid
  ),
  tpc AS (
    SELECT t.tid AS tid,
           COALESCE(MAX(1 - (a.embedding <=> b.embedding)), 0) AS s
      FROM targets t
      LEFT JOIN public.topic_embeddings a ON a.user_id = p_viewer_id
      LEFT JOIN public.topic_embeddings b ON b.user_id = t.tid
     GROUP BY t.tid
  )
  SELECT
    t.tid,
    GREATEST(0::float, LEAST(1::float, COALESCE(fwd.s, 0))) AS semantic_no,
    GREATEST(0::float, LEAST(1::float, COALESCE(rev.s, 0))) AS semantic_rv,
    GREATEST(0::float, LEAST(1::float, COALESCE(tpc.s, 0))) AS semantic_topic
  FROM targets t
  LEFT JOIN fwd ON fwd.tid = t.tid
  LEFT JOIN rev ON rev.tid = t.tid
  LEFT JOIN tpc ON tpc.tid = t.tid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_pair_embeddings_batch(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_pair_embeddings_batch(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_pair_embeddings_batch(UUID, UUID[]) TO service_role;

-- ────────────────────────────────────────
-- 3) judge_pair_cache に text_hash 列追加 (P4 指摘 #5: 永続バグ修正)
-- ────────────────────────────────────────
ALTER TABLE public.judge_pair_cache
  ADD COLUMN IF NOT EXISTS need_text_hash  TEXT,
  ADD COLUMN IF NOT EXISTS offer_text_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_judge_pair_cache_hash
  ON public.judge_pair_cache(viewer_id, target_id, need_text_hash, offer_text_hash);

COMMENT ON COLUMN public.judge_pair_cache.need_text_hash IS
  'sha256(viewer.need_vectors[need_idx].text + solver_profile). コンシューマは現在の hash と一致しない行を破棄すべき。';
COMMENT ON COLUMN public.judge_pair_cache.offer_text_hash IS
  'sha256(target.offer_vectors[offer_idx].text + beneficiary_profile). 同上。';
