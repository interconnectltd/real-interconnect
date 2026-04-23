-- ============================================================
-- tl;dv トランスクリプト連携 × AIマッチング
-- 新規5テーブル + RLSポリシー
-- ============================================================

-- 1. meeting_transcripts: トランスクリプト本文・メタデータ
CREATE TABLE IF NOT EXISTS meeting_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tldv_meeting_id TEXT NOT NULL,
    tldv_record_id UUID REFERENCES tldv_meeting_records(id),
    title TEXT,
    meeting_date TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    raw_transcript JSONB,
    full_text TEXT,
    language TEXT DEFAULT 'ja',
    word_count INTEGER,
    speaker_count INTEGER,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'fetching', 'ready', 'analyzing', 'analyzed', 'error')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_transcripts_tldv_id ON meeting_transcripts(tldv_meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_status ON meeting_transcripts(status);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_date ON meeting_transcripts(meeting_date DESC);

-- 2. meeting_participants: 参加者とuser_idの紐付け
CREATE TABLE IF NOT EXISTS meeting_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT,
    speaker_name TEXT,
    speaking_duration_seconds INTEGER,
    speaking_ratio DECIMAL(5,4),
    word_count INTEGER,
    is_linked BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(transcript_id, email)
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_email ON meeting_participants(email);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_transcript ON meeting_participants(transcript_id);

-- 3. transcript_insights: AI分析結果（参加者ごと）
CREATE TABLE IF NOT EXISTS transcript_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES meeting_participants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    extracted_interests TEXT[] DEFAULT '{}',
    extracted_skills TEXT[] DEFAULT '{}',
    extracted_needs TEXT[] DEFAULT '{}',
    extracted_offerings TEXT[] DEFAULT '{}',
    extracted_industries TEXT[] DEFAULT '{}',
    key_topics TEXT[] DEFAULT '{}',
    sentiment_score DECIMAL(3,2),
    communication_style JSONB,
    expertise_indicators JSONB,

    ai_model TEXT,
    ai_prompt_version TEXT,
    confidence_score DECIMAL(3,2),
    raw_ai_response JSONB,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_insights_user ON transcript_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_transcript_insights_transcript ON transcript_insights(transcript_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_insights_unique ON transcript_insights(transcript_id, participant_id);

-- 4. member_ai_profiles: 複数ミーティングの集約プロフィール
CREATE TABLE IF NOT EXISTS member_ai_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    aggregated_interests TEXT[] DEFAULT '{}',
    aggregated_skills TEXT[] DEFAULT '{}',
    aggregated_needs TEXT[] DEFAULT '{}',
    aggregated_offerings TEXT[] DEFAULT '{}',
    primary_industries TEXT[] DEFAULT '{}',

    communication_profile JSONB DEFAULT '{}',
    expertise_confidence JSONB DEFAULT '{}',

    total_meetings_analyzed INTEGER DEFAULT 0,
    total_speaking_minutes INTEGER DEFAULT 0,
    last_analysis_at TIMESTAMP WITH TIME ZONE,
    profile_version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_ai_profiles_user ON member_ai_profiles(user_id);

-- 5. matching_scores_cache: 事前計算済みマッチングスコア
CREATE TABLE IF NOT EXISTS matching_scores_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    profile_score DECIMAL(5,2) DEFAULT 0,
    transcript_score DECIMAL(5,2) DEFAULT 0,
    interaction_score DECIMAL(5,2) DEFAULT 0,
    total_score DECIMAL(5,2) DEFAULT 0,

    match_reasons JSONB DEFAULT '[]',

    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_stale BOOLEAN DEFAULT false,

    UNIQUE(user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_matching_cache_user_a ON matching_scores_cache(user_a_id);
CREATE INDEX IF NOT EXISTS idx_matching_cache_user_b ON matching_scores_cache(user_b_id);
CREATE INDEX IF NOT EXISTS idx_matching_cache_score ON matching_scores_cache(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_matching_cache_stale ON matching_scores_cache(is_stale) WHERE is_stale = true;

-- ============================================================
-- user_profiles にトランスクリプト分析同意カラム追加
-- ============================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS transcript_analysis_consent BOOLEAN DEFAULT false;

-- ============================================================
-- RLS ポリシー
-- ============================================================

-- meeting_transcripts: service_role + admin
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages transcripts" ON meeting_transcripts
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Admin can view transcripts" ON meeting_transcripts
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- meeting_participants: 自分の参加記録のみ閲覧可
ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own participation" ON meeting_participants
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role manages participants" ON meeting_participants
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- transcript_insights: 自分のインサイトのみ閲覧可
ALTER TABLE transcript_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own insights" ON transcript_insights
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role manages insights" ON transcript_insights
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- member_ai_profiles: 自分のAIプロフィールのみ閲覧可
ALTER TABLE member_ai_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own AI profile" ON member_ai_profiles
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role manages AI profiles" ON member_ai_profiles
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- matching_scores_cache: 自分が関わるスコアのみ閲覧可
ALTER TABLE matching_scores_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own matching scores" ON matching_scores_cache
    FOR SELECT USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);
CREATE POLICY "Service role manages matching cache" ON matching_scores_cache
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
