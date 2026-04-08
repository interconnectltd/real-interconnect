-- ============================================================
-- Migration 00004: Full Data Structure (設計書完璧版 1_Overview)
-- 38テーブル + 12 ENUM の完全定義
-- 既存テーブルとの差分のみ追加
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUM定義 (E01-E12)
-- ────────────────────────────────────────────────────────────

-- E01: goal_type — 既存ENUMを拡張 (hiring→recruitment, info_exchange→information)
-- カラムを一旦TEXTに→ENUM DROP/再作成→カラムをENUMに戻す
ALTER TABLE public.user_goals ALTER COLUMN type TYPE TEXT;
ALTER TABLE public.user_offerings ALTER COLUMN type TYPE TEXT;

DROP TYPE IF EXISTS public.goal_type;
CREATE TYPE public.goal_type AS ENUM (
  'partnership',    -- 事業提携
  'consulting',     -- 経営相談
  'investment',     -- 投資
  'recruitment',    -- 採用
  'information',    -- 情報交換
  'mentoring'       -- メンタリング
);

ALTER TABLE public.user_goals ALTER COLUMN type TYPE public.goal_type USING type::public.goal_type;
ALTER TABLE public.user_offerings ALTER COLUMN type TYPE public.goal_type USING type::public.goal_type;

-- E02: connection_status (7種 — 既存CHECK制約をENUMに昇格)
CREATE TYPE public.connection_status AS ENUM (
  'pending', 'accepted', 'declined', 'cancelled', 'disconnected', 'reaccepted', 'blocked'
);

-- E03: notification_type の拡張 (6種→14種)
ALTER TABLE public.notifications ALTER COLUMN type TYPE TEXT;
DROP TYPE IF EXISTS public.notification_type;
CREATE TYPE public.notification_type AS ENUM (
  'connection_request',
  'meeting_request',
  'meeting_confirmed',
  'meeting_summary',
  'introduction_request',
  'introduction_completed',
  'new_match_weekly',
  'new_match_high',
  'mutual_match',
  'maturity_up',
  'contact_exchange',
  'intervention_alert',
  'followup_reminder',
  'system'
);
ALTER TABLE public.notifications ALTER COLUMN type TYPE public.notification_type USING type::text::public.notification_type;

-- E04: meeting_status
CREATE TYPE public.meeting_status AS ENUM (
  'proposed', 'confirmed', 'completed', 'cancelled', 'no_show'
);

-- E05: introduction_status
CREATE TYPE public.introduction_status AS ENUM (
  'pending', 'approved', 'declined'
);

-- E06: job_type 拡張
ALTER TABLE public.job_queue ALTER COLUMN type TYPE TEXT;
DROP TYPE IF EXISTS public.job_type;
CREATE TYPE public.job_type AS ENUM (
  'analyze', 'aggregate', 'score', 'notify', 'ingest', 'calibrate'
);
ALTER TABLE public.job_queue ALTER COLUMN type TYPE public.job_type USING type::public.job_type;

-- E08: subscription_status
CREATE TYPE public.subscription_status AS ENUM (
  'free', 'active', 'past_due', 'cancelled'
);

-- E09: signal_type
CREATE TYPE public.signal_type AS ENUM (
  'profile_view', 'search_query', 'filter_use', 'card_click', 'card_ignore',
  'request_sent', 'request_accepted', 'request_declined',
  'meeting_booked', 'followup_sent', 'second_meeting', 'profile_scroll_depth'
);

-- E10: transcript_source
CREATE TYPE public.transcript_source AS ENUM (
  'recall_ai', 'tldv', 'notta', 'otter', 'manual'
);

-- E11: meeting_platform
CREATE TYPE public.meeting_platform AS ENUM (
  'zoom', 'google_meet', 'teams', 'slack', 'other'
);

-- E12: feedback_stage
CREATE TYPE public.feedback_stage AS ENUM (
  'immediate', 'behavior_48h', 'outcome_30d'
);

-- ────────────────────────────────────────────────────────────
-- 2. 新規テーブル
-- ────────────────────────────────────────────────────────────

-- T09: match_feedback — 3段階フィードバック
CREATE TABLE public.match_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matcher_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  matched_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  meeting_id      UUID,  -- FK追加後に参照
  stage           public.feedback_stage NOT NULL,
  rating          INT CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feedback_matcher ON public.match_feedback(matcher_id);

-- T10: manual_recommendations — 管理者手動マッチ推薦
CREATE TABLE public.manual_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES public.user_profiles(id),
  user_a_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  user_b_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  reason          TEXT,
  is_accepted     BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T11: user_signals — 暗黙行動シグナル
CREATE TABLE public.user_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_user_id  UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  signal_type     public.signal_type NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_signals_user ON public.user_signals(user_id, created_at DESC);
CREATE INDEX idx_signals_type ON public.user_signals(signal_type, created_at DESC);

-- T12: signal_aggregates — 日次集計済みシグナル
CREATE TABLE public.signal_aggregates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  signal_counts   JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- T13: matrix_versions — 属性マトリクス自動補正履歴
CREATE TABLE public.matrix_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL UNIQUE,
  matrix_data     JSONB NOT NULL,
  metrics         JSONB DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T14: ab_tests
CREATE TABLE public.ab_tests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  variants        JSONB NOT NULL DEFAULT '["control","treatment"]',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

-- T15: ab_test_assignments
CREATE TABLE public.ab_test_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id         UUID NOT NULL REFERENCES public.ab_tests(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  variant         TEXT NOT NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(test_id, user_id)
);

-- T17: introductions — 紹介仲介(Warm Intro)
CREATE TABLE public.introductions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  introducer_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status          public.introduction_status NOT NULL DEFAULT 'pending',
  message         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T18: meeting_requests — 会議リクエスト(候補日時付き)
CREATE TABLE public.meeting_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  message         TEXT,
  proposed_times  JSONB DEFAULT '[]',
  status          public.meeting_status NOT NULL DEFAULT 'proposed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T19: meetings — 確定済み会議
CREATE TABLE public.meetings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID REFERENCES public.meeting_requests(id) ON DELETE SET NULL,
  title           TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_min    INT DEFAULT 30,
  platform        public.meeting_platform DEFAULT 'zoom',
  meeting_url     TEXT,
  status          public.meeting_status NOT NULL DEFAULT 'confirmed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- match_feedback にmeeting FK追加
ALTER TABLE public.match_feedback
  ADD CONSTRAINT fk_feedback_meeting
  FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;

-- T20: meeting_participants
CREATE TABLE public.meeting_participants_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role            TEXT DEFAULT 'participant',
  joined_at       TIMESTAMPTZ,
  left_at         TIMESTAMPTZ,
  UNIQUE(meeting_id, user_id)
);

-- T21: meeting_threads — 会議スレッド(1会議=1スレッド)
CREATE TABLE public.meeting_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL UNIQUE REFERENCES public.meetings(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T22: meeting_messages — スレッド内メッセージ
CREATE TABLE public.meeting_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES public.meeting_threads(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_thread ON public.meeting_messages(thread_id, created_at);

-- T23: group_matches — グループマッチ/ラウンドテーブル
CREATE TABLE public.group_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by      UUID NOT NULL REFERENCES public.user_profiles(id),
  title           TEXT NOT NULL,
  description     TEXT,
  scheduled_at    TIMESTAMPTZ,
  max_participants INT DEFAULT 6,
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','full','completed','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T24: group_match_members
CREATE TABLE public.group_match_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.group_matches(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- T25: transcript_sources — BYOB連携設定
CREATE TABLE public.transcript_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  source_type     public.transcript_source NOT NULL,
  api_key_enc     TEXT,  -- 暗号化されたAPIキー
  webhook_url     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, source_type)
);

-- T26: transcript_raw — 取り込み済み生テキスト
CREATE TABLE public.transcript_raw (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  meeting_id      UUID REFERENCES public.meetings(id) ON DELETE SET NULL,
  source          public.transcript_source NOT NULL,
  external_id     TEXT,
  raw_text        TEXT NOT NULL,
  duration_sec    INT,
  recorded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, external_id)
);

-- T27: normalized_transcripts — 正規化済み文字起こし
CREATE TABLE public.normalized_transcripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_id          UUID NOT NULL REFERENCES public.transcript_raw(id) ON DELETE CASCADE,
  speakers        JSONB DEFAULT '[]',
  segments        JSONB DEFAULT '[]',
  language        TEXT DEFAULT 'ja',
  word_count      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T28: transcript_insights は既存。normalized_transcripts との FK追加
ALTER TABLE public.transcript_insights
  ADD COLUMN IF NOT EXISTS normalized_transcript_id UUID
  REFERENCES public.normalized_transcripts(id) ON DELETE SET NULL;

-- T29: goal_change_events — goals変化検知ログ
CREATE TABLE public.goal_change_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  change_type     TEXT NOT NULL CHECK (change_type IN ('added','removed','context_updated')),
  goal_type       public.goal_type,
  old_value       JSONB,
  new_value       JSONB,
  source          TEXT DEFAULT 'manual',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T31: email_digest_log — 週次メール配信ログ
CREATE TABLE public.email_digest_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  digest_type     TEXT NOT NULL DEFAULT 'weekly',
  content_summary JSONB DEFAULT '{}',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at       TIMESTAMPTZ
);

-- T32: step_sequences — ステップ配信定義
CREATE TABLE public.step_sequences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  trigger_event   TEXT NOT NULL,
  steps           JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T33: step_delivery_log — ステップ配信実行ログ
CREATE TABLE public.step_delivery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID NOT NULL REFERENCES public.step_sequences(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  step_index      INT NOT NULL,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT DEFAULT 'delivered' CHECK (status IN ('delivered','opened','clicked','failed'))
);

-- T34: communities — コミュニティ(Stripe連携)
CREATE TABLE public.communities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  owner_id        UUID NOT NULL REFERENCES public.user_profiles(id),
  member_count    INT NOT NULL DEFAULT 0,
  max_free_members INT NOT NULL DEFAULT 200,
  subscription_status public.subscription_status NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- T36: audit_logs — 重要操作の監査ログ
CREATE TABLE public.audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  metadata        JSONB DEFAULT '{}',
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action, created_at DESC);

-- T37: intervention_log — 低評価介入の記録
CREATE TABLE public.intervention_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  trigger_type    TEXT NOT NULL,
  action_taken    TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. RLS (新規テーブル)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.match_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matrix_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.introductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_match_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalized_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_digest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_log ENABLE ROW LEVEL SECURITY;

-- 自己データ系
CREATE POLICY "own_feedback" ON public.match_feedback FOR ALL USING (auth.uid() = matcher_id);
CREATE POLICY "own_signals" ON public.user_signals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_signal_agg" ON public.signal_aggregates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_transcript_sources" ON public.transcript_sources FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_goal_changes" ON public.goal_change_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own_digest_log" ON public.email_digest_log FOR SELECT USING (auth.uid() = user_id);

-- 認証ユーザー閲覧系
CREATE POLICY "auth_view_meetings" ON public.meetings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_view_meeting_participants" ON public.meeting_participants_v2 FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_view_group_matches" ON public.group_matches FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_view_ab_tests" ON public.ab_tests FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_view_communities" ON public.communities FOR SELECT USING (auth.role() = 'authenticated');

-- 参加者系
CREATE POLICY "participant_view_threads" ON public.meeting_threads FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.meeting_participants_v2 mp WHERE mp.meeting_id = meeting_threads.meeting_id AND mp.user_id = auth.uid())
);
CREATE POLICY "participant_view_messages" ON public.meeting_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.meeting_threads mt JOIN public.meeting_participants_v2 mp ON mp.meeting_id = mt.meeting_id WHERE mt.id = meeting_messages.thread_id AND mp.user_id = auth.uid())
);
CREATE POLICY "participant_send_messages" ON public.meeting_messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- 会議リクエスト
CREATE POLICY "own_meeting_requests" ON public.meeting_requests FOR ALL USING (
  auth.uid() = requester_id OR auth.uid() = target_id
);

-- 紹介
CREATE POLICY "own_introductions" ON public.introductions FOR ALL USING (
  auth.uid() = requester_id OR auth.uid() = introducer_id OR auth.uid() = target_id
);

-- 管理者系
CREATE POLICY "admin_all_manual_recs" ON public.manual_recommendations FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "admin_all_matrix" ON public.matrix_versions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "admin_all_interventions" ON public.intervention_log FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "admin_all_audit" ON public.audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "admin_all_sequences" ON public.step_sequences FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
);

-- ────────────────────────────────────────────────────────────
-- 4. connections テーブルのstatus ENUM化
-- ────────────────────────────────────────────────────────────
-- 既存のCHECK制約をENUMに置換
ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_status_check;
ALTER TABLE public.connections ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.connections ALTER COLUMN status TYPE public.connection_status USING status::public.connection_status;
ALTER TABLE public.connections ALTER COLUMN status SET DEFAULT 'pending';

-- ────────────────────────────────────────────────────────────
-- 完了
-- T01(auth.users): Supabase管理 — 変更不要
-- T02-T06: 既存 (migrations 00001-00003)
-- T07-T08: 既存 (migrations 00001-00002)
-- T09-T15: 本マイグレーションで新規作成
-- T16: connections — ENUM化のみ
-- T17-T24: 本マイグレーションで新規作成
-- T25-T29: 本マイグレーションで新規作成
-- T30: notifications — ENUM拡張のみ
-- T31-T34: 本マイグレーションで新規作成
-- T35: profile_views — 既存 (migration 00001)
-- T36-T37: 本マイグレーションで新規作成
-- T38: job_queue — ENUM拡張のみ
-- ────────────────────────────────────────────────────────────
