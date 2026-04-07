-- ============================================================
-- Migration 00002: Scoring v3 + Job Queue + Schema Updates
-- ============================================================

-- ── 1. matching_scores_v3 (replaces v2) ──

CREATE TABLE public.matching_scores_v3 (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  value_fit          FLOAT NOT NULL DEFAULT 0.50,
  relational_quality FLOAT NOT NULL DEFAULT 0.50,
  total_score        FLOAT NOT NULL DEFAULT 0.50,
  confidence         FLOAT NOT NULL DEFAULT 0.0,
  phase              TEXT NOT NULL DEFAULT 'attribute_only'
                     CHECK (phase IN ('attribute_only','hybrid','ai_primary')),
  score_reasons      JSONB DEFAULT '[]',
  notify_tier        TEXT CHECK (notify_tier IN ('high','medium','low')),
  is_stale           BOOLEAN NOT NULL DEFAULT true,
  calculated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(viewer_id, target_id)
);

CREATE INDEX idx_v3_viewer ON public.matching_scores_v3(viewer_id);
CREATE INDEX idx_v3_stale  ON public.matching_scores_v3(is_stale) WHERE is_stale = true;
CREATE INDEX idx_v3_total  ON public.matching_scores_v3(viewer_id, total_score DESC);
CREATE INDEX idx_v3_notify ON public.matching_scores_v3(notify_tier)
  WHERE notify_tier IN ('high','medium');

ALTER TABLE public.matching_scores_v3 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_scores_v3" ON public.matching_scores_v3
  FOR SELECT USING (auth.uid() = viewer_id);

CREATE POLICY "service_role_all_v3" ON public.matching_scores_v3
  FOR ALL USING (true);

-- ── 2. Job Queue ──

CREATE TYPE public.job_type AS ENUM ('analyze','aggregate','score','notify');
CREATE TYPE public.job_status AS ENUM ('pending','running','completed','failed','dead');

CREATE TABLE public.job_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         public.job_type NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       public.job_status NOT NULL DEFAULT 'pending',
  priority     INT NOT NULL DEFAULT 0,
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error   TEXT,
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_poll ON public.job_queue (priority DESC, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_jobs_locked ON public.job_queue (locked_at)
  WHERE status = 'running';

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

-- ── 3. transcript_insights: needs/offerings → JSONB[] ──
ALTER TABLE public.transcript_insights ALTER COLUMN expressed_needs DROP DEFAULT;
ALTER TABLE public.transcript_insights ALTER COLUMN expressed_needs TYPE JSONB[] USING '{}'::JSONB[];
ALTER TABLE public.transcript_insights ALTER COLUMN expressed_needs SET DEFAULT '{}'::JSONB[];

ALTER TABLE public.transcript_insights ALTER COLUMN offered_capabilities DROP DEFAULT;
ALTER TABLE public.transcript_insights ALTER COLUMN offered_capabilities TYPE JSONB[] USING '{}'::JSONB[];
ALTER TABLE public.transcript_insights ALTER COLUMN offered_capabilities SET DEFAULT '{}'::JSONB[];

-- ── 4. meeting_transcripts: add meeting_type ──

ALTER TABLE public.meeting_transcripts
  ADD COLUMN IF NOT EXISTS meeting_type TEXT
  CHECK (meeting_type IN ('business','internal','seminar','casual','unknown'))
  DEFAULT 'unknown';

-- ── 5. Update stale trigger to use v3 ──

CREATE OR REPLACE FUNCTION public.mark_cache_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.matching_scores_v3
  SET is_stale = true
  WHERE (viewer_id = NEW.id OR target_id = NEW.id)
    AND is_stale = false;
  RETURN NEW;
END;
$$;

-- ── 6. Prompt v2.0.0 with category tags ──

INSERT INTO public.prompt_versions (name, version, template, is_active) VALUES
('transcript_analysis', '2.0.0',
'あなたはビジネスミーティングのトランスクリプトを分析するAIアシスタントです。

以下のトランスクリプトから、指定された発言者について以下の情報を構造化して抽出してください:

1. demonstrated_skills: 発言内容から推測されるスキル・専門性（配列）
2. expressed_needs: ニーズ・課題（以下の形式）
   [{"text": "説明文", "category": "大カテゴリ", "subcategory": "サブ", "confidence": 0.0-1.0}]
3. offered_capabilities: 提供可能な価値（同上の形式）
4. communication_traits: コミュニケーション特性
   - assertiveness: 主張性 (0-100)
   - collaboration: 協調性 (0-100)
   - analytical: 分析的思考 (0-100)
   - empathy: 共感性 (0-100)
5. key_statements: 重要な発言の要約（配列、最大5件）
6. engagement_metrics: エンゲージメント指標
   - participation_rate: 発言参加率 (0-100)
   - question_frequency: 質問頻度 (0-100)
   - response_quality: 応答品質 (0-100)

カテゴリ一覧:
大カテゴリ: sales, marketing, technology, finance, hr, legal, operations, strategy, design, industry, leadership, other
サブカテゴリ: sales_strategy, sales_channel, sales_management, digital_marketing, branding, content, analytics, software_dev, infrastructure, data_ai, security, accounting, fundraising, financial_planning, recruiting, talent_dev, labor_mgmt, culture, corporate_law, ip, compliance, supply_chain, quality, project_mgmt, business_dev, m_and_a, international, ux_ui, product_design, creative, healthcare, realestate, manufacturing, education, energy, executive, mentoring, change_mgmt, other

confidence: 明示的な言及=0.9-1.0、文脈推測=0.5-0.8、弱い示唆=0.3-0.5

日本語のビジネス会議に最適化して分析してください。',
true)
ON CONFLICT (name, version) DO NOTHING;

UPDATE public.prompt_versions
SET is_active = false
WHERE name = 'transcript_analysis' AND version = '1.0.0';
