-- =============================================================
-- V2 Scoring — Haiku LLM Judgment Cache
-- SCORING_V2_ARCHITECTURE.md §3 — Haiku 4-text crossmatch (+10 score core)
--
-- Stores per-pair, per-(need, offer) Haiku judgment results so re-computes
-- can reuse them. One row per (viewer_id, target_id, need_idx, offer_idx).
--   h_no       : forward score viewer.need ↔ target.offer  (0-1)
--   h_rv       : reverse score target.need ↔ viewer.offer  (0-1)
--   reason_no  : 15-char reason for forward direction
--   reason_rv  : 15-char reason for reverse direction
-- =============================================================

CREATE TABLE IF NOT EXISTS public.judge_pair_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  need_idx        INT  NOT NULL,
  offer_idx       INT  NOT NULL,
  h_no            FLOAT NOT NULL DEFAULT 0.0 CHECK (h_no  BETWEEN 0 AND 1),
  h_rv            FLOAT NOT NULL DEFAULT 0.0 CHECK (h_rv  BETWEEN 0 AND 1),
  reason_no       TEXT,
  reason_rv       TEXT,
  prompt_version  TEXT NOT NULL DEFAULT 'haiku-judge-1.0.0',
  judged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(viewer_id, target_id, need_idx, offer_idx)
);

CREATE INDEX IF NOT EXISTS idx_judge_pair_cache_viewer_target
  ON public.judge_pair_cache(viewer_id, target_id);

CREATE INDEX IF NOT EXISTS idx_judge_pair_cache_judged_at
  ON public.judge_pair_cache(judged_at DESC);

-- ---- Row Level Security ----
ALTER TABLE public.judge_pair_cache ENABLE ROW LEVEL SECURITY;

-- Service role: full access (worker writes via service role)
CREATE POLICY "service_judge_pair_cache" ON public.judge_pair_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Authenticated users may READ rows where they are the viewer.
-- Writes are service-only (no INSERT/UPDATE/DELETE policy for authenticated).
CREATE POLICY "viewer_read_own_judge_pair_cache" ON public.judge_pair_cache
  FOR SELECT
  USING (auth.uid() = viewer_id);

-- =============================================================
-- judge_quota_log: per-viewer-per-day cost guard
-- Tracks how many pair judgments have been enqueued for a viewer
-- on a given UTC date. Cap = 100 pairs/viewer/day (see judge.ts).
-- =============================================================
CREATE TABLE IF NOT EXISTS public.judge_quota_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  quota_date   DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  pairs_used   INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(viewer_id, quota_date)
);

CREATE INDEX IF NOT EXISTS idx_judge_quota_log_viewer_date
  ON public.judge_quota_log(viewer_id, quota_date);

ALTER TABLE public.judge_quota_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_judge_quota_log" ON public.judge_quota_log
  FOR ALL
  USING (true)
  WITH CHECK (true);
