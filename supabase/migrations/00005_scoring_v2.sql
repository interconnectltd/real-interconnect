-- =============================================================
-- V2 Scoring Migration: Step 1
-- テーブル作成 + プロンプト v3.0.0 + scoring_config 初期値
-- =============================================================

-- 1. user_conversation_vectors
CREATE TABLE IF NOT EXISTS public.user_conversation_vectors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  need_vectors       JSONB NOT NULL DEFAULT '[]',
  offer_vectors      JSONB NOT NULL DEFAULT '[]',
  expertise_vectors  JSONB NOT NULL DEFAULT '[]',
  topic_vectors      JSONB NOT NULL DEFAULT '[]',
  engagement_signature JSONB NOT NULL DEFAULT '{}',
  evidence_index     JSONB NOT NULL DEFAULT '{}',
  hidden_items       JSONB NOT NULL DEFAULT '[]',
  analysis_count     INT NOT NULL DEFAULT 0,
  meeting_ids        UUID[] DEFAULT '{}',
  last_analyzed_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_conversation_vectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_vectors" ON public.user_conversation_vectors
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "service_vectors" ON public.user_conversation_vectors
  FOR ALL USING (true);

-- 2. matching_scores_v4
CREATE TABLE IF NOT EXISTS public.matching_scores_v4 (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  need_offer_score   FLOAT NOT NULL DEFAULT 0.0,
  reverse_match      FLOAT NOT NULL DEFAULT 0.0,
  expertise_fit      FLOAT NOT NULL DEFAULT 0.0,
  topic_alignment    FLOAT NOT NULL DEFAULT 0.0,
  engagement_value   FLOAT NOT NULL DEFAULT 0.0,
  history_score      FLOAT NOT NULL DEFAULT 0.0,
  total_score        FLOAT NOT NULL DEFAULT 0.0,
  confidence         FLOAT NOT NULL DEFAULT 0.0,
  phase              TEXT NOT NULL DEFAULT 'attribute_only'
                     CHECK (phase IN ('attribute_only','hybrid','ai_primary')),
  score_reasons      JSONB DEFAULT '[]',
  notify_tier        TEXT CHECK (notify_tier IN ('high','medium','low')),
  is_stale           BOOLEAN NOT NULL DEFAULT true,
  config_version     TEXT DEFAULT '1.0',
  algorithm_version  TEXT DEFAULT 'v2.0',
  calculated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(viewer_id, target_id)
);

CREATE INDEX idx_v4_viewer ON matching_scores_v4(viewer_id) WHERE NOT is_stale;
CREATE INDEX idx_v4_stale ON matching_scores_v4(is_stale) WHERE is_stale = true;

ALTER TABLE public.matching_scores_v4 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "viewer_scores_v4" ON public.matching_scores_v4
  FOR SELECT USING (auth.uid() = viewer_id);
CREATE POLICY "service_scores_v4" ON public.matching_scores_v4
  FOR ALL USING (true);

-- stale トリガー
CREATE OR REPLACE FUNCTION mark_scores_v4_stale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE matching_scores_v4 SET is_stale = true
  WHERE viewer_id = NEW.user_id OR target_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stale_scores_v4
  AFTER INSERT OR UPDATE ON user_conversation_vectors
  FOR EACH ROW EXECUTE FUNCTION mark_scores_v4_stale();

-- 3. correction_log
CREATE TABLE IF NOT EXISTS public.correction_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  vector_id          TEXT,
  correction_type    TEXT NOT NULL
                     CHECK (correction_type IN ('resolved','nuance_wrong','not_mine','not_my_need','other')),
  correction_text    TEXT,
  original_text      TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.correction_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_corrections" ON public.correction_log
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "service_corrections" ON public.correction_log
  FOR ALL USING (true);

-- 4. feedback_log
CREATE TABLE IF NOT EXISTS public.feedback_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  rating             INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  value_tags         JSONB DEFAULT '[]',
  haiku_no_at_time   FLOAT,
  haiku_rv_at_time   FLOAT,
  config_version     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_feedback" ON public.feedback_log
  FOR ALL USING (auth.uid() = viewer_id);
CREATE POLICY "service_feedback" ON public.feedback_log
  FOR ALL USING (true);

-- 5. scoring_config
CREATE TABLE IF NOT EXISTS public.scoring_config (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         TEXT NOT NULL UNIQUE,
  weights_json       JSONB NOT NULL,
  alpha_table_json   JSONB NOT NULL,
  boost_params_json  JSONB NOT NULL,
  validated_accuracy FLOAT,
  validation_details JSONB DEFAULT '{}',
  is_active          BOOLEAN NOT NULL DEFAULT false,
  applied_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_config" ON public.scoring_config
  FOR ALL USING (true);
CREATE POLICY "authenticated_read_config" ON public.scoring_config
  FOR SELECT USING (auth.role() = 'authenticated');

-- 6. prompt_versions 拡張
ALTER TABLE public.prompt_versions
  ADD COLUMN IF NOT EXISTS model_version TEXT DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN IF NOT EXISTS validated_accuracy FLOAT,
  ADD COLUMN IF NOT EXISTS few_shot_count INT DEFAULT 0;

-- 7. v3.0.0 プロンプト INSERT
-- テンプレートは worker/src/handlers/analyze.ts にハードコード (PROMPT_V3)。
-- DB にはバージョン管理用のマーカーを格納。
-- Phase 2 で A/B テスト実装時に DB テンプレートに移行。
INSERT INTO public.prompt_versions (name, version, template, is_active, model_version)
VALUES (
  'transcript_analysis',
  '3.0.0',
  'V3_OPUS_PROMPT_HARDCODED_IN_WORKER',
  true,
  'claude-opus-4-6'
) ON CONFLICT (name, version) DO NOTHING;

-- v2.0.0 を非アクティブに
UPDATE public.prompt_versions
SET is_active = false
WHERE name = 'transcript_analysis' AND version != '3.0.0';

-- 8. scoring_config 初期値
INSERT INTO public.scoring_config (version_id, weights_json, alpha_table_json, boost_params_json, is_active, applied_at)
VALUES (
  '1.0',
  '{
    "high": {"need_offer": 0.50, "reverse_match": 0.10, "expertise_fit": 0.08, "topic_alignment": 0.08, "engagement_value": 0.24},
    "medium": {"need_offer": 0.40, "reverse_match": 0.12, "expertise_fit": 0.10, "topic_alignment": 0.10, "engagement_value": 0.28},
    "low": {"need_offer": 0.28, "reverse_match": 0.12, "expertise_fit": 0.14, "topic_alignment": 0.12, "engagement_value": 0.34},
    "thresholds": {"high": 0.80, "medium": 0.60}
  }',
  '{"0": 0.00, "1": 0.50, "2": 0.75, "3": 0.88, "4": 0.95, "partial": 0.20}',
  '{"threshold_85": 0.08, "threshold_70": 0.04, "surprise_bonus_max": 0.06, "surprise_attr_max": 0.45, "surprise_conv_min": 0.45, "monotonic_threshold": 0.40}',
  true,
  now()
) ON CONFLICT (version_id) DO NOTHING;
