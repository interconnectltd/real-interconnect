# INTERCONNECT バックエンド＆データ基盤実装計画書

**作成日**: 2026-03-31
**対象**: Phase 1 バックエンド全域
**技術**: Supabase (Postgres + Auth + Realtime + Storage) / Next.js API Routes / Render (Worker + Cron) / Claude Sonnet 4.6

---

## 1. データベーススキーマ (Phase 1)

### 1.1 コアテーブル

```sql
-- ========================================
-- user_profiles
-- ========================================
CREATE TABLE public.user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT,
  position    TEXT,
  industry    TEXT,
  bio         TEXT,
  avatar_url  TEXT,
  cover_url   TEXT,
  contact_info TEXT,  -- LINE ID/メール等 (コネクション成立後のみ公開)
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profiles_industry ON public.user_profiles(industry);
CREATE INDEX idx_user_profiles_is_active ON public.user_profiles(is_active);

-- ========================================
-- connections
-- ========================================
CREATE TABLE public.connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  connected_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected','cancelled','removed','blocked','reaccepted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, connected_user_id)
);

CREATE INDEX idx_connections_user_status ON public.connections(user_id, status);
CREATE INDEX idx_connections_connected_user ON public.connections(connected_user_id, status);

-- ========================================
-- notifications
-- ========================================
CREATE TYPE notification_type AS ENUM (
  'connection_request',
  'connection_accepted',
  'match_mutual',
  'event_reminder',
  'referral_accepted',
  'point_earned'
);

CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  link       TEXT,
  actions    JSONB,  -- {allowedActions: ['accept','reject','view_profile']}
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_read ON public.notifications(user_id, is_read);
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
```

### 1.2 マッチングテーブル

```sql
-- ========================================
-- match_requests
-- ========================================
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

-- ========================================
-- match_connections (成立済みマッチング)
-- ========================================
CREATE TABLE public.match_connections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  user2_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  score      FLOAT,
  reasons    JSONB,  -- {summary: string, details: string[]}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user1_id, user2_id)
);
```

### 1.3 トランスクリプト・AI分析テーブル

```sql
-- ========================================
-- meeting_transcripts
-- ========================================
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

CREATE INDEX idx_transcripts_status ON public.meeting_transcripts(status);

-- ========================================
-- meeting_participants
-- ========================================
CREATE TABLE public.meeting_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id   UUID NOT NULL REFERENCES public.meeting_transcripts(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  speaker_name    TEXT NOT NULL,
  email           TEXT,
  speaking_ratio  FLOAT,
  is_linked       BOOLEAN NOT NULL DEFAULT false,
  linked_method   TEXT,  -- 'email'|'name_exact'|'name_partial'|'past_link'|'manual'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_participants_transcript ON public.meeting_participants(transcript_id);
CREATE INDEX idx_participants_user ON public.meeting_participants(user_id);

-- ========================================
-- transcript_insights
-- ========================================
CREATE TABLE public.transcript_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id         UUID NOT NULL REFERENCES public.meeting_transcripts(id) ON DELETE CASCADE,
  participant_id        UUID NOT NULL REFERENCES public.meeting_participants(id) ON DELETE CASCADE,
  demonstrated_skills   TEXT[] DEFAULT '{}',
  expressed_needs       TEXT[] DEFAULT '{}',
  offered_capabilities  TEXT[] DEFAULT '{}',
  communication_traits  JSONB DEFAULT '{}',
  -- {assertiveness: float, collaboration: float, analytical: float, empathy: float}
  key_statements        TEXT[] DEFAULT '{}',
  engagement_metrics    JSONB DEFAULT '{}',
  -- {participation_rate: float, question_frequency: float, response_quality: float}
  confidence_score      FLOAT,
  prompt_version        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_insights_transcript ON public.transcript_insights(transcript_id);
CREATE INDEX idx_insights_participant ON public.transcript_insights(participant_id);

-- ========================================
-- member_ai_profiles_v2
-- ========================================
CREATE TABLE public.member_ai_profiles_v2 (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  aggregated_skills      JSONB[] DEFAULT '{}',
  -- [{skill: string, frequency: int, weight: float, last_seen: timestamptz}]
  aggregated_needs       JSONB[] DEFAULT '{}',
  aggregated_offerings   JSONB[] DEFAULT '{}',
  communication_profile  JSONB DEFAULT '{}',
  -- {assertiveness: float, collaboration: float, analytical: float, empathy: float}
  analysis_count         INT NOT NULL DEFAULT 0,
  last_analyzed_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================================
-- matching_scores_v2
-- ========================================
CREATE TABLE public.matching_scores_v2 (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id                     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  target_id                     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  needs_fulfillment             FLOAT NOT NULL DEFAULT 50,     -- 35%
  skill_complementarity         FLOAT NOT NULL DEFAULT 50,     -- 25%
  communication_compatibility   FLOAT NOT NULL DEFAULT 50,     -- 15%
  engagement_quality            FLOAT NOT NULL DEFAULT 50,     -- 15%
  interaction_history            FLOAT NOT NULL DEFAULT 0,      -- 10%
  total_score                   FLOAT NOT NULL DEFAULT 50,
  weights                       JSONB DEFAULT '{"needs":0.35,"skill":0.25,"comm":0.15,"engagement":0.15,"history":0.10}',
  score_reasons                 JSONB DEFAULT '{}',
  -- {summary: string, highlights: string[], axis_reasons: {needs: string, skill: string, ...}}
  is_stale                      BOOLEAN NOT NULL DEFAULT true,
  calculated_at                 TIMESTAMPTZ DEFAULT now(),
  UNIQUE(viewer_id, target_id)
);

CREATE INDEX idx_scores_viewer ON public.matching_scores_v2(viewer_id);
CREATE INDEX idx_scores_stale ON public.matching_scores_v2(is_stale) WHERE is_stale = true;
CREATE INDEX idx_scores_total ON public.matching_scores_v2(viewer_id, total_score DESC);

-- ========================================
-- mutual_match_notifications (通知重複防止)
-- ========================================
CREATE TABLE public.mutual_match_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  user_b_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_a_id, user_b_id)
);
```

### 1.4 ユーザー行動テーブル

```sql
-- ========================================
-- profile_views
-- ========================================
CREATE TABLE public.profile_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  viewed_user_id  UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  view_duration   INT,  -- seconds
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profile_views_viewed ON public.profile_views(viewed_user_id, viewed_at DESC);

-- ========================================
-- bookmarks
-- ========================================
CREATE TABLE public.bookmarks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  bookmarked_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, bookmarked_user_id)
);
```

### 1.5 システムテーブル

```sql
-- ========================================
-- settings
-- ========================================
CREATE TABLE public.settings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  theme                  TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','system')),
  notifications_enabled  BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================================
-- prompt_versions
-- ========================================
CREATE TABLE public.prompt_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  version    TEXT NOT NULL,
  template   TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);

-- ========================================
-- login_sessions (Phase 1でテーブル作成、UIはPhase 3)
-- ========================================
CREATE TABLE public.login_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  device     TEXT,
  browser    TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 2. RLSポリシー

```sql
-- 全テーブルでRLS有効化
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

-- ==========================================
-- パターン1: 自己データ（CRUD）
-- ==========================================
CREATE POLICY "users_own_profile" ON public.user_profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "users_own_settings" ON public.settings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_bookmarks" ON public.bookmarks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_notifications" ON public.notifications
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_login_sessions" ON public.login_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- ==========================================
-- パターン2: 認証ユーザー閲覧
-- ==========================================
CREATE POLICY "authenticated_view_profiles" ON public.user_profiles
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND is_active = true
  );

CREATE POLICY "authenticated_view_connections" ON public.connections
  FOR SELECT USING (
    auth.uid() = user_id OR auth.uid() = connected_user_id
  );

CREATE POLICY "authenticated_view_scores" ON public.matching_scores_v2
  FOR SELECT USING (auth.uid() = viewer_id);

CREATE POLICY "authenticated_view_ai_profiles" ON public.member_ai_profiles_v2
  FOR SELECT USING (auth.role() = 'authenticated');

-- ==========================================
-- パターン3: 管理者全操作
-- ==========================================
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

-- ==========================================
-- パターン4: 公開コンテンツ（SELECT only）
-- ==========================================
CREATE POLICY "public_read_prompt_versions" ON public.prompt_versions
  FOR SELECT USING (is_active = true);

-- ==========================================
-- パターン5: 認証ユーザー書込み
-- ==========================================
CREATE POLICY "authenticated_insert_connections" ON public.connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_insert_profile_views" ON public.profile_views
  FOR INSERT WITH CHECK (auth.uid() = viewer_id AND viewer_id != viewed_user_id);

CREATE POLICY "authenticated_insert_match_requests" ON public.match_requests
  FOR INSERT WITH CHECK (auth.uid() = requester_id);

-- ==========================================
-- パターン6: service_role（バックエンドWorker用）
-- ==========================================
-- service_roleはRLSをバイパスするため、ポリシー定義不要
-- Worker/Cron/Edge Functionからはservice_roleクライアントを使用
```

---

## 3. DB関数・トリガー

```sql
-- ========================================
-- handle_new_user(): 新規ユーザー自動セットアップ
-- ========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );

  INSERT INTO public.settings (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========================================
-- update_updated_at(): 汎用タイムスタンプ更新
-- ========================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

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

-- ========================================
-- protect_admin(): is_admin/is_active変更防止
-- ========================================
CREATE OR REPLACE FUNCTION public.protect_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    -- service_roleのみ変更可
    IF current_setting('role') != 'service_role' THEN
      RAISE EXCEPTION 'is_admin and is_active can only be modified by service_role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_admin
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin();

-- ========================================
-- マッチング関数群
-- ========================================

-- mark_cache_stale: プロフィール更新時にスコアを無効化
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

CREATE TRIGGER trg_profile_stale_scores
  AFTER UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mark_cache_stale();

-- get_public_ai_profiles: ニーズを非公開にした公開AIプロフィール
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
  -- aggregated_needs は意図的に除外（プライバシー保護）
END;
$$;

-- purge_ai_data_on_delete: 退会時AI関連データ全削除
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
```

---

## 4. API設計 (Phase 1)

### 4.1 共通レスポンス型

```typescript
// APIレスポンス共通型
interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { page: number; totalPages: number; totalCount: number };
}

// 認証ミドルウェア
async function withAuth(req: NextRequest): Promise<{ user: User; supabase: SupabaseClient }> {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, 'UNAUTHORIZED', '認証が必要です');
  return { user, supabase };
}

async function withAdmin(req: NextRequest): Promise<{ user: User; supabase: SupabaseClient }> {
  const { user, supabase } = await withAuth(req);
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) throw new ApiError(403, 'FORBIDDEN', '管理者権限が必要です');
  return { user, supabase };
}
```

### 4.2 エンドポイント一覧

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| GET | /api/v1/profiles/[id] | 認証 | プロフィール取得 (contact_infoはコネクション成立時のみ) |
| PATCH | /api/v1/profiles/me | 認証 | 自分のプロフィール更新 |
| POST | /api/v1/profiles/avatar | 認証 | アバターアップロード (Supabase Storage) |
| GET | /api/v1/connections | 認証 | コネクション一覧 (filter: status, search) |
| POST | /api/v1/connections | 認証 | コネクション申請 (重複チェック + 通知作成) |
| PATCH | /api/v1/connections/[id] | 認証 | ステータス更新 (accept/reject/cancel/remove/block) |
| GET | /api/v1/matching/scores | 認証 | マッチングスコア一覧 (filter, sort, pagination) |
| GET | /api/v1/matching/[userId] | 認証 | 特定ユーザーとの5軸詳細スコア |
| GET | /api/v1/matching/mutual | 認証 | 相互マッチ一覧 (双方70%超) |
| GET | /api/v1/notifications | 認証 | 通知一覧 (filter: is_read) |
| PATCH | /api/v1/notifications | 認証 | 通知既読更新 (ids[]) |
| PATCH | /api/v1/notifications/read-all | 認証 | 一括既読 |
| GET | /api/v1/bookmarks | 認証 | ブックマーク一覧 |
| POST | /api/v1/bookmarks | 認証 | ブックマーク追加 |
| DELETE | /api/v1/bookmarks | 認証 | ブックマーク解除 (bookmarked_user_id) |
| GET | /api/v1/members | 認証 | メンバー検索 (search, industry, skill, pagination) |
| POST | /api/v1/profile-views | 認証 | 閲覧記録保存 (自分除外) |
| GET | /api/v1/health | 公開 | ヘルスチェック (DB疎通確認) |

### 4.3 contact_info 可視性制御

```typescript
// GET /api/v1/profiles/[id]
async function getProfile(req, { params }) {
  const { user, supabase } = await withAuth(req);
  const { id } = params;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .single();

  if (!profile) throw new ApiError(404, 'NOT_FOUND', 'プロフィールが見つかりません');

  // contact_info: コネクション成立済みの場合のみ公開
  if (id !== user.id) {
    const { data: connection } = await supabase
      .from('connections')
      .select('status')
      .or(`and(user_id.eq.${user.id},connected_user_id.eq.${id}),and(user_id.eq.${id},connected_user_id.eq.${user.id})`)
      .eq('status', 'accepted')
      .maybeSingle();

    if (!connection) {
      profile.contact_info = null;
    }
  }

  return Response.json({ data: profile, error: null });
}
```

---

## 5. 双方向マッチングアルゴリズム

### 5.1 パイプライン全体図

```
[Render Cron: JST 9/12/15/18]
  │
  ▼
(1) tl;dv API ポーリング
  │  新規ミーティング検出
  │  meeting_transcripts UPSERT (status: pending → fetching → ready)
  │  meeting_participants UPSERT
  │
  ▼
(2) スピーカー紐付け (多段階)
  │  ①メール直接一致
  │  ②正規化名前完全一致
  │  ③姓部分一致
  │  ④過去リンク履歴参照
  │  → is_linked = true, linked_method 記録
  │
  ▼
(3) Claude Sonnet 4.6 分析 [Render Worker]
  │  status: ready → analyzing
  │  発言者ごとに構造化抽出:
  │    - demonstrated_skills[]
  │    - expressed_needs[]
  │    - offered_capabilities[]
  │    - communication_traits {assertiveness, collaboration, analytical, empathy}
  │    - key_statements[]
  │    - engagement_metrics {participation_rate, question_frequency, response_quality}
  │  Zodスキーマでパース保証
  │  → transcript_insights INSERT
  │  status: analyzing → analyzed
  │  リトライ: 指数バックオフ max 3回
  │
  ▼
(4) AIプロフィール集約
  │  複数会議のinsights → member_ai_profiles_v2
  │  増分マージ (差分更新)
  │  頻度重み: 1回=tentative(1.0) / 2回=confirmed(2.0) / 3回+=high(3.0)
  │  時間減衰: 3ヶ月以内=100% / 6ヶ月以内=70% / 超=40%
  │  communication_profile: 全会議の加重平均
  │
  ▼
(5) 双方向スコアリング [Render Worker]
  │  is_stale=true のペアのみ再計算
  │  5軸サブスコア → total_score → score_reasons
  │
  ▼
(6) 相互マッチ通知
     双方のスコア >= 70% → mutual_match_notifications で重複チェック
     → notifications INSERT + Realtime配信
```

### 5.2 5軸スコア計算

```typescript
interface ScoreInput {
  viewer: AiProfile;  // viewer の AIプロフィール
  target: AiProfile;  // target の AIプロフィール
  sharedMeetings: number;  // 共同ミーティング数
}

function calculateScore(input: ScoreInput): ScoreResult {
  const { viewer, target, sharedMeetings } = input;

  // (1) needs_fulfillment: 35%
  //     viewer のニーズを target の提供物が満たす度合い
  const needsFulfillment = semanticSimilarity(
    viewer.aggregated_needs,
    target.aggregated_offerings
  );

  // (2) skill_complementarity: 25%
  //     target が viewer にない補完スキルを持つ度合い
  const skillComplementarity = complementScore(
    viewer.aggregated_skills,
    target.aggregated_skills
  );

  // (3) communication_compatibility: 15%
  //     4軸 (assertiveness, collaboration, analytical, empathy) の相性
  const commCompat = communicationCompatibility(
    viewer.communication_profile,
    target.communication_profile
  );

  // (4) engagement_quality: 15%
  //     共同会議での関与品質
  const engagementQuality = calculateEngagement(viewer, target);

  // (5) interaction_history: 10%
  //     共同ミーティング回数（逓減: 1回=20, 2回=15, 3回=10, 4回+=5, 上限100）
  const interactionHistory = Math.min(100,
    sharedMeetings >= 4 ? 20 + 15 + 10 + (sharedMeetings - 3) * 5
    : sharedMeetings === 3 ? 20 + 15 + 10
    : sharedMeetings === 2 ? 20 + 15
    : sharedMeetings === 1 ? 20
    : 0
  );

  const totalScore =
    needsFulfillment * 0.35 +
    skillComplementarity * 0.25 +
    commCompat * 0.15 +
    engagementQuality * 0.15 +
    interactionHistory * 0.10;

  return {
    needs_fulfillment: needsFulfillment,
    skill_complementarity: skillComplementarity,
    communication_compatibility: commCompat,
    engagement_quality: engagementQuality,
    interaction_history: interactionHistory,
    total_score: totalScore,
  };
}
```

### 5.3 フォールバック（AI分析データなしユーザー）

```typescript
function calculateFallbackScore(viewer: UserProfile, target: UserProfile): ScoreResult {
  // プロフィール情報 (industry/position/bio) のみで簡易評価
  // 重み配分: needs=50%, skill=30%, history=20%

  const needsScore = profileBasedNeedScore(viewer, target);   // industry + position マッチ
  const skillScore = profileBasedSkillScore(viewer, target);  // bio キーワード分析
  const historyScore = 0;  // 会議履歴なし

  // transcript系3軸は中立値 50
  return {
    needs_fulfillment: needsScore * 0.5 + 50 * 0.5,
    skill_complementarity: skillScore * 0.3 + 50 * 0.7,
    communication_compatibility: 50,  // 中立
    engagement_quality: 50,            // 中立
    interaction_history: historyScore,
    total_score:
      (needsScore * 0.5 + 50 * 0.5) * 0.35 +
      (skillScore * 0.3 + 50 * 0.7) * 0.25 +
      50 * 0.15 +
      50 * 0.15 +
      0 * 0.10,
  };
}
```

### 5.4 O(n^2)最適化戦略

| 戦略 | 適用フェーズ | 説明 |
|------|-------------|------|
| is_stale差分計算 | Phase 1 | 変更があったペアのみ再計算 |
| バッチサイズ制限 | Phase 1 | 1回のWorker実行で最大500ペア |
| 同業種フィルタリング | Phase 1 | 全ペアではなく関連性の高い候補に限定 |
| オンデマンド計算 | Phase 2 | マッチング画面閲覧時にリアルタイム計算 |
| score_reasons テンプレート化 | Phase 1推奨 | Claude API呼び出しを避け、スコア軸に基づくテンプレート生成 |

**Phase 1 想定規模**: ~100-500ユーザー → 最大250,000ペアだがis_stale差分で実効1,000-5,000ペア/バッチ

### 5.5 score_reasons 生成

レビュアー指摘に基づき、Phase 1ではテンプレートベースを推奨:

```typescript
function generateScoreReasons(score: ScoreResult, viewer: Profile, target: Profile): ScoreReasons {
  const highlights: string[] = [];

  if (score.needs_fulfillment >= 70) {
    highlights.push(`${target.name}さんは${viewer.name}さんのニーズに高い適合性があります`);
  }
  if (score.skill_complementarity >= 70) {
    highlights.push(`互いのスキルが補完的です`);
  }
  if (score.interaction_history >= 40) {
    highlights.push(`過去の会議で良好な関係性が見られます`);
  }

  return {
    summary: `総合マッチ度 ${Math.round(score.total_score)}%`,
    highlights,
    axis_reasons: {
      needs: score.needs_fulfillment >= 60 ? '高い適合性' : '普通',
      skill: score.skill_complementarity >= 60 ? '補完的' : '類似',
      comm: score.communication_compatibility >= 60 ? '相性良好' : '普通',
      engagement: score.engagement_quality >= 60 ? '活発' : '普通',
      history: score.interaction_history > 0 ? `${Math.round(score.interaction_history / 20)}回の共同会議` : 'なし',
    },
  };
}
```

---

## 6. 認証フロー

### 6.1 Email/Password

```
[登録]
ユーザー → RegisterForm (name/email/password/会社名/役職/利用規約同意)
  → Zod バリデーション
  → supabase.auth.signUp({ email, password, options: { data: { name, company, position } } })
  → Supabase Auth: auth.users INSERT
  → トリガー: on_auth_user_created → handle_new_user()
    → user_profiles INSERT
    → settings INSERT
  → 確認メール送信
  → /login?confirmed=true リダイレクト

[ログイン]
ユーザー → LoginForm (email/password)
  → supabase.auth.signInWithPassword({ email, password })
  → セッション確立 (JWT)
  → login_sessions INSERT (device/browser/ip)
  → /dashboard リダイレクト

[パスワードリセット]
ユーザー → ForgotPasswordForm (email)
  → supabase.auth.resetPasswordForEmail(email, { redirectTo: '/reset-password' })
  → リセットメール送信
  → ユーザーがリンククリック → /reset-password
  → ResetPasswordForm (new password)
  → supabase.auth.updateUser({ password })
```

### 6.2 Facebook OAuth

```
[ログイン/登録]
ユーザー → FacebookLoginButton
  → supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo: `${origin}/auth/callback` }
    })
  → Facebook OAuth画面
  → Facebook → Supabase Auth コールバック
  → Supabase Auth: auth.users UPSERT
    → 新規: on_auth_user_created トリガー発火
    → 既存: セッション更新
  → /auth/callback ページ
  → supabase.auth.exchangeCodeForSession(code)
  → /dashboard リダイレクト

[アカウントリンク設計判断]
  同一メールの Email + Facebook アカウント:
  → Supabase の autoConfirmUsers + allowUnlinkedIdentities 設定で制御
  → 推奨: 同一メールは自動リンク (Supabase Dashboard > Auth > Settings)
```

### 6.3 セッション管理

```typescript
// providers/supabase-provider.tsx
// AuthProvider: onAuthStateChange でセッション監視
// トークン自動リフレッシュ (Supabase SDK 組み込み)

// middleware.ts
// 認証ガード:
//   未認証 → /login リダイレクト
//   非管理者の /admin → /dashboard リダイレクト
//   認証済みの /login, /register → /dashboard リダイレクト
```

### 6.4 Storage設定

```sql
-- avatars バケット
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true);

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

-- covers バケット (同様の構造、5MB制限)
INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true);

-- ファイルサイズ制限は Supabase Dashboard > Storage > Policies で設定
-- avatars: 2MB / covers: 5MB / 画像のみ (image/*)
```

---

## 7. Render インフラ設計

```yaml
# render.yaml
services:
  # Web Service (Next.js)
  - type: web
    name: interconnect-web
    runtime: node
    plan: starter
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    healthCheckPath: /api/v1/health
    envVars:
      - key: NEXT_PUBLIC_SUPABASE_URL
        sync: false
      - key: NEXT_PUBLIC_SUPABASE_ANON_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false

  # Background Worker (分析 + スコアリング)
  - type: worker
    name: interconnect-worker
    runtime: node
    plan: starter
    buildCommand: pnpm install && pnpm build:worker
    startCommand: pnpm start:worker
    envVars:
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: AI_API_KEY
        sync: false

  # Cron Job (tl;dv ポーリング)
  - type: cron
    name: interconnect-tldv-fetch
    runtime: node
    schedule: "0 0,3,6,9 * * *"  # UTC 0,3,6,9 = JST 9,12,15,18
    buildCommand: pnpm install && pnpm build:cron
    startCommand: pnpm start:cron-tldv
    envVars:
      - key: TLDV_API_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
```
