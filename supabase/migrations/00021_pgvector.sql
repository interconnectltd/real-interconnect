-- =============================================================
-- 00021_pgvector.sql — Track-B: Semantic-Space Placement Layer
-- =============================================================
-- SCORING_V2_ARCHITECTURE.md §1.2 (solver_profile / beneficiary_profile),
-- §3.2 (4-text crossmatch), §13 (Phase 3 pgvector future).
--
-- Goal: enable cosine-similarity matching between needs and offers
-- using OpenAI text-embedding-3-small (1536-dim).
--
-- Design decisions:
-- 1) Separate normalized tables (need_embeddings / offer_embeddings /
--    topic_embeddings) instead of JSONB columns on user_conversation_vectors.
--    Rationale: HNSW index requires `vector` *column*, not JSON path. Also keeps
--    the rebuild path cheap (re-embed without rewriting whole user row).
-- 2) HNSW (not IVFFlat) — pgvector >= 0.5. m=16, ef_construction=64 are sane
--    defaults: m=16 keeps build memory <50MB at 10k vectors and query latency
--    <5ms; ef_construction=64 trades minor build time for better recall (>97%).
--    Our corpus is small (<128 rows) so build is instantaneous; we pre-tune for
--    1k-user scale.
-- 3) text_hash (sha256) makes upserts idempotent — avoids re-billing OpenAI for
--    unchanged need.text + solver_profile pairs. The hash is computed in TS at
--    write time (not in SQL).
-- 4) RLS: service_role full write; authenticated read of own user_id only.
-- 5) match_pair_embeddings RPC is SECURITY DEFINER and fenced with
--    auth.uid() = p_viewer_id — prevents cross-user enumeration via the
--    similarity ranker.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────
-- need_embeddings
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.need_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  need_idx      INT  NOT NULL,
  text_hash     TEXT NOT NULL,
  embedding     vector(1536) NOT NULL,
  model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, need_idx)
);

CREATE INDEX IF NOT EXISTS idx_need_embeddings_user
  ON public.need_embeddings(user_id);

-- HNSW index for cosine similarity queries
-- Justification: HNSW > IVFFlat for our use-case because:
--  - read-heavy (every viewer×target pair query hits this index)
--  - small corpus (<10k rows even at 1k users) → memory cost trivial
--  - >97% recall@10 vs IVFFlat's 92-95% at default lists=100
CREATE INDEX IF NOT EXISTS idx_need_embeddings_hnsw
  ON public.need_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.need_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_need_embeddings"
  ON public.need_embeddings AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "own_need_embeddings_select"
  ON public.need_embeddings AS PERMISSIVE FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────
-- offer_embeddings
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.offer_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  offer_idx     INT  NOT NULL,
  text_hash     TEXT NOT NULL,
  embedding     vector(1536) NOT NULL,
  model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, offer_idx)
);

CREATE INDEX IF NOT EXISTS idx_offer_embeddings_user
  ON public.offer_embeddings(user_id);

CREATE INDEX IF NOT EXISTS idx_offer_embeddings_hnsw
  ON public.offer_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.offer_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_offer_embeddings"
  ON public.offer_embeddings AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "own_offer_embeddings_select"
  ON public.offer_embeddings AS PERMISSIVE FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────
-- topic_embeddings
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.topic_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  topic_idx     INT  NOT NULL,
  text_hash     TEXT NOT NULL,
  embedding     vector(1536) NOT NULL,
  model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic_idx)
);

CREATE INDEX IF NOT EXISTS idx_topic_embeddings_user
  ON public.topic_embeddings(user_id);

CREATE INDEX IF NOT EXISTS idx_topic_embeddings_hnsw
  ON public.topic_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.topic_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_topic_embeddings"
  ON public.topic_embeddings AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "own_topic_embeddings_select"
  ON public.topic_embeddings AS PERMISSIVE FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────
-- match_pair_embeddings RPC
-- ────────────────────────────────────────
-- Returns:
--   semantic_no_score : best cosine sim between viewer.need × target.offer
--   semantic_rv_score : best cosine sim between target.need × viewer.offer
--   semantic_topic    : best cosine sim between viewer.topic × target.topic
--
-- Cosine sim is converted from pgvector's cosine *distance* via
--   sim = 1 - (a <=> b)
-- so the score is in [0,1] with 1 = identical (matches our other dims).
--
-- SECURITY DEFINER + auth.uid() = p_viewer_id fence: only the viewer can
-- pull their own pair scores. Prevents cross-user cosine enumeration.
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_pair_embeddings(
  p_viewer_id UUID,
  p_target_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_no FLOAT := 0;
  v_rv FLOAT := 0;
  v_topic FLOAT := 0;
BEGIN
  -- service_role bypasses (caller is null when called from worker / RPC client
  -- with SUPABASE_SERVICE_ROLE_KEY which sets auth.uid() = null).
  -- For authenticated calls, viewer must be the caller.
  IF v_caller IS NOT NULL AND v_caller <> p_viewer_id THEN
    RAISE EXCEPTION 'forbidden: caller must equal p_viewer_id';
  END IF;

  IF p_viewer_id = p_target_id THEN
    RETURN jsonb_build_object('semantic_no', 0, 'semantic_rv', 0, 'semantic_topic', 0);
  END IF;

  -- Best need×offer cosine (viewer.need × target.offer)
  SELECT COALESCE(MAX(1 - (n.embedding <=> o.embedding)), 0)
    INTO v_no
    FROM public.need_embeddings n
    JOIN public.offer_embeddings o ON true
   WHERE n.user_id = p_viewer_id
     AND o.user_id = p_target_id;

  -- Reverse: target.need × viewer.offer
  SELECT COALESCE(MAX(1 - (n.embedding <=> o.embedding)), 0)
    INTO v_rv
    FROM public.need_embeddings n
    JOIN public.offer_embeddings o ON true
   WHERE n.user_id = p_target_id
     AND o.user_id = p_viewer_id;

  -- Topic alignment
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

REVOKE EXECUTE ON FUNCTION public.match_pair_embeddings(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_pair_embeddings(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_pair_embeddings(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.match_pair_embeddings IS
  'Track-B: returns top-1 cosine similarity per direction (need×offer + topic).
   SECURITY DEFINER fenced with auth.uid()=p_viewer_id.
   Used by src/lib/matching/embedding.ts applyEmbeddingScore.';
