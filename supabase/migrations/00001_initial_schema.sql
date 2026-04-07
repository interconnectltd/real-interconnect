-- ============================================================
-- INTERCONNECT — Initial Schema Migration
-- Phase 1: 16 tables, 15 indexes, 6 functions, 7 triggers,
--           RLS policies, Storage buckets, Seed data
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. CUSTOM TYPES
-- ────────────────────────────────────────────────────────────

CREATE TYPE public.notification_type AS ENUM (
  'connection_request',
  'connection_accepted',
  'match_mutual',
  'event_reminder',
  'referral_accepted',
  'point_earned'
);

-- ────────────────────────────────────────────────────────────
-- 2. TABLES
-- ────────────────────────────────────────────────────────────

-- user_profiles
CREATE TABLE public.user_profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  company      TEXT,
  position     TEXT,
  industry     TEXT,
  bio          TEXT,
  avatar_url   TEXT,
  cover_url    TEXT,
  contact_info TEXT,
  is_admin     BOOLEAN NOT NULL DEFAULT false,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- connections
CREATE TABLE public.connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  connected_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','cancelled','disconnected','blocked','reaccepted')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, connected_user_id)
);

-- notifications
CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type       public.notification_type NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  link       TEXT,
  actions    JSONB,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- match_requests
CREATE TABLE public.match_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','rejected','cancelled')),
  message      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(requester_id, recipient_id)
);

-- match_connections
CREATE TABLE public.match_connections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  user2_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  score      FLOAT,
  reasons    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user1_id, user2_id)
);

-- meeting_transcripts
CREATE TABLE public.meeting_transcripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tldv_meeting_id TEXT NOT NULL UNIQUE,
  title           TEXT,
  meeting_date    TIMESTAMPTZ,
  full_text       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','fetching','ready','analyzing','analyzed','error')),
  error_message   TEXT,
  fetched_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- meeting_participants
CREATE TABLE public.meeting_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES public.meeting_transcripts(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  speaker_name  TEXT NOT NULL,
  email         TEXT,
  speaking_ratio FLOAT,
  is_linked     BOOLEAN NOT NULL DEFAULT false,
  linked_method TEXT CHECK (linked_method IN ('email','name_exact','name_partial','past_link','manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- transcript_insights
CREATE TABLE public.transcript_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id         UUID NOT NULL REFERENCES public.meeting_transcripts(id) ON DELETE CASCADE,
  participant_id        UUID NOT NULL REFERENCES public.meeting_participants(id) ON DELETE CASCADE,
  demonstrated_skills   TEXT[] DEFAULT '{}',
  expressed_needs       TEXT[] DEFAULT '{}',
  offered_capabilities  TEXT[] DEFAULT '{}',
  communication_traits  JSONB DEFAULT '{}',
  key_statements        TEXT[] DEFAULT '{}',
  engagement_metrics    JSONB DEFAULT '{}',
  confidence_score      FLOAT,
  prompt_version        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- member_ai_profiles_v2
CREATE TABLE public.member_ai_profiles_v2 (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  aggregated_skills      JSONB[] DEFAULT '{}',
  aggregated_needs       JSONB[] DEFAULT '{}',
  aggregated_offerings   JSONB[] DEFAULT '{}',
  communication_profile  JSONB DEFAULT '{}',
  analysis_count         INT NOT NULL DEFAULT 0,
  last_analyzed_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- matching_scores_v2
CREATE TABLE public.matching_scores_v2 (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id                   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id                   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  needs_fulfillment           FLOAT NOT NULL DEFAULT 50,
  skill_complementarity       FLOAT NOT NULL DEFAULT 50,
  communication_compatibility FLOAT NOT NULL DEFAULT 50,
  engagement_quality          FLOAT NOT NULL DEFAULT 50,
  interaction_history         FLOAT NOT NULL DEFAULT 0,
  total_score                 FLOAT NOT NULL DEFAULT 50,
  weights                     JSONB DEFAULT '{"needs":0.35,"skill":0.25,"comm":0.15,"engagement":0.15,"history":0.10}',
  score_reasons               JSONB DEFAULT '{}',
  is_stale                    BOOLEAN NOT NULL DEFAULT true,
  calculated_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE(viewer_id, target_id)
);

-- mutual_match_notifications
CREATE TABLE public.mutual_match_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  user_b_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_a_id, user_b_id)
);

-- profile_views
CREATE TABLE public.profile_views (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  viewed_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  view_duration  INT,
  viewed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- bookmarks
CREATE TABLE public.bookmarks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  bookmarked_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, bookmarked_user_id)
);

-- settings
CREATE TABLE public.settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  theme                 TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','system')),
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- prompt_versions
CREATE TABLE public.prompt_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  version    TEXT NOT NULL,
  template   TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);

-- login_sessions
CREATE TABLE public.login_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  device     TEXT,
  browser    TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. INDEXES
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_user_profiles_industry ON public.user_profiles(industry);
CREATE INDEX idx_user_profiles_active ON public.user_profiles(is_active);

CREATE INDEX idx_connections_user_status ON public.connections(user_id, status);
CREATE INDEX idx_connections_connected ON public.connections(connected_user_id, status);

CREATE INDEX idx_notifications_user_read ON public.notifications(user_id, is_read);
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

CREATE INDEX idx_transcripts_status ON public.meeting_transcripts(status);

CREATE INDEX idx_participants_transcript ON public.meeting_participants(transcript_id);
CREATE INDEX idx_participants_user ON public.meeting_participants(user_id);

CREATE INDEX idx_insights_transcript ON public.transcript_insights(transcript_id);
CREATE INDEX idx_insights_participant ON public.transcript_insights(participant_id);

CREATE INDEX idx_scores_viewer ON public.matching_scores_v2(viewer_id);
CREATE INDEX idx_scores_stale ON public.matching_scores_v2(is_stale) WHERE is_stale = true;
CREATE INDEX idx_scores_total ON public.matching_scores_v2(viewer_id, total_score DESC);

CREATE INDEX idx_profile_views_viewed ON public.profile_views(viewed_user_id, viewed_at DESC);

-- ────────────────────────────────────────────────────────────
-- 4. FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- handle_new_user: auto-create profile + settings on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name, email, company, position, industry, bio)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'company', ''),
    NULLIF(NEW.raw_user_meta_data->>'position', ''),
    NULLIF(NEW.raw_user_meta_data->>'industry', ''),
    NULLIF(NEW.raw_user_meta_data->>'bio', '')
  );
  INSERT INTO public.settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- update_updated_at: generic timestamp updater
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- protect_admin: prevent non-service_role from changing is_admin/is_active
CREATE OR REPLACE FUNCTION public.protect_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'is_admin and is_active can only be modified by service_role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- mark_cache_stale: invalidate matching scores on profile update
CREATE OR REPLACE FUNCTION public.mark_cache_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.matching_scores_v2
  SET is_stale = true
  WHERE viewer_id = NEW.id OR target_id = NEW.id;
  RETURN NEW;
END;
$$;

-- get_public_ai_profiles: return AI profiles without needs (privacy)
CREATE OR REPLACE FUNCTION public.get_public_ai_profiles(p_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  aggregated_skills JSONB[],
  aggregated_offerings JSONB[],
  communication_profile JSONB,
  analysis_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.user_id,
    m.aggregated_skills,
    m.aggregated_offerings,
    m.communication_profile,
    m.analysis_count
  FROM public.member_ai_profiles_v2 m
  JOIN public.user_profiles p ON p.id = m.user_id
  WHERE p.is_active = true
    AND m.user_id != p_user_id;
END;
$$;

-- purge_ai_data_on_delete: remove all AI data for a user (account deletion)
CREATE OR REPLACE FUNCTION public.purge_ai_data_on_delete(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.transcript_insights
  WHERE participant_id IN (
    SELECT id FROM public.meeting_participants WHERE user_id = p_user_id
  );
  DELETE FROM public.member_ai_profiles_v2 WHERE user_id = p_user_id;
  DELETE FROM public.matching_scores_v2
  WHERE viewer_id = p_user_id OR target_id = p_user_id;
  UPDATE public.meeting_participants
  SET user_id = NULL, is_linked = false
  WHERE user_id = p_user_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. TRIGGERS
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_connections_updated_at
  BEFORE UPDATE ON public.connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_member_ai_profiles_updated_at
  BEFORE UPDATE ON public.member_ai_profiles_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_protect_admin
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin();

CREATE TRIGGER trg_profile_stale_scores
  AFTER UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mark_cache_stale();

-- ────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_ai_profiles_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_scores_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutual_match_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_sessions ENABLE ROW LEVEL SECURITY;

-- Pattern 1: Own data
CREATE POLICY "users_own_profile_select" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_own_profile_update" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "users_own_settings" ON public.settings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_bookmarks" ON public.bookmarks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_notifications" ON public.notifications
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_login_sessions" ON public.login_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- Pattern 2: Authenticated read
CREATE POLICY "authenticated_view_profiles" ON public.user_profiles
  FOR SELECT USING (auth.role() = 'authenticated' AND is_active = true);

CREATE POLICY "authenticated_view_connections" ON public.connections
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = connected_user_id);

CREATE POLICY "authenticated_view_scores" ON public.matching_scores_v2
  FOR SELECT USING (auth.uid() = viewer_id);

CREATE POLICY "authenticated_view_ai_profiles" ON public.member_ai_profiles_v2
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_view_transcripts" ON public.meeting_transcripts
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_view_participants" ON public.meeting_participants
  FOR SELECT USING (auth.role() = 'authenticated');

-- Pattern 3: Admin full access
CREATE POLICY "admin_all_profiles" ON public.user_profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "admin_all_transcripts" ON public.meeting_transcripts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "admin_all_prompt_versions" ON public.prompt_versions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Pattern 4: Public read
CREATE POLICY "public_read_active_prompts" ON public.prompt_versions
  FOR SELECT USING (is_active = true);

-- Pattern 5: Authenticated write
CREATE POLICY "authenticated_insert_connections" ON public.connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_update_connections" ON public.connections
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = connected_user_id);

CREATE POLICY "authenticated_insert_profile_views" ON public.profile_views
  FOR INSERT WITH CHECK (auth.uid() = viewer_id AND viewer_id != viewed_user_id);

CREATE POLICY "authenticated_insert_match_requests" ON public.match_requests
  FOR INSERT WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "authenticated_insert_login_sessions" ON public.login_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 7. STORAGE BUCKETS
-- ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('covers', 'covers', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- avatars policies
CREATE POLICY "avatar_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatar_auth_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatar_own_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatar_own_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- covers policies
CREATE POLICY "cover_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'covers');

CREATE POLICY "cover_auth_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'covers'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "cover_own_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "cover_own_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ────────────────────────────────────────────────────────────
-- 8. SEED DATA
-- ────────────────────────────────────────────────────────────

INSERT INTO public.prompt_versions (name, version, template, is_active) VALUES
(
  'transcript_analysis',
  '1.0.0',
  'あなたはビジネスミーティングのトランスクリプトを分析するAIアシスタントです。

以下のトランスクリプトから、指定された発言者について以下の情報を構造化して抽出してください:

1. demonstrated_skills: 発言内容から推測されるスキル・専門性（配列）
2. expressed_needs: 発言内容から推測されるニーズ・課題（配列）
3. offered_capabilities: 提供可能な価値・サービス（配列）
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

日本語のビジネス会議に最適化して分析してください。',
  true
),
(
  'matching_score',
  '1.0.0',
  'placeholder - score_reasons are template-based in Phase 1',
  false
);

-- ────────────────────────────────────────────────────────────
-- NOTE: Industries reference (for application use, not DB table)
-- IT・テクノロジー, コンサルティング, 金融・保険, 製造業,
-- 不動産, 医療・ヘルスケア, 教育, マーケティング・広告,
-- 人材・HR, 小売・EC, エネルギー, メディア・エンタメ,
-- 法律, 建設, 物流・運輸, その他
-- ────────────────────────────────────────────────────────────
