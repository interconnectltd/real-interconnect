-- 00061_calendar_events.sql
--
-- calendar_events テーブル: Google Calendar 等から同期したイベントを保管。
--
-- 経緯: 00032_calendar_phase_b.sql で calendar_connections / availability_rules /
--   availability_overrides は作ったが、events 本体の DDL がリポに不存在のまま
--   src/types/database.ts と src/app/api/v1/calendar/events/route.ts が
--   `from("calendar_events")` を参照していた。Supabase が schema cache 不在で
--   500 を返し続け、UI 上は「カレンダーイベントはありません」と空状態に化け
--   ていたためユーザに気付かれにくかった。本 migration で正式に作成する。
--
-- 設計:
--   - connection_id FK → calendar_connections(id) on delete cascade
--     (接続を切ったら同期済みイベントも消す)
--   - user_id FK → user_profiles(id) on delete cascade
--     (RLS フィルタ用に直接持つ。 connection_id 経由 JOIN を避けて読み高速化)
--   - external_event_id は Google/Microsoft 側の event id。
--     (connection_id, external_event_id) で UNIQUE 制約 → upsert 安全
--   - linked_meeting_id は INTERCONNECT 内の meetings に紐付く場合のみ
--     SET NULL on delete (meeting 側を消しても外部 calendar entry は残す)
--
-- RLS:
--   - 自分の row のみ SELECT
--   - insert/update/delete は service_role 専用 (Google sync worker / Webhook)
--     UI から calendar_events を直接書く操作は現状 API 上に存在しない
--
-- schema cache reload を最後に notify pgrst で発火

-- ────────────────────────────────────────
-- 1) calendar_events 本体
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  -- 外部 provider 側の event identifier
  external_event_id   TEXT NOT NULL,
  title               TEXT,
  start_at            TIMESTAMPTZ NOT NULL,
  end_at              TIMESTAMPTZ NOT NULL,
  -- 会議リンク (Zoom/Meet/Teams URL)
  video_url           TEXT,
  video_platform      TEXT,
  -- 参加者 email 配列 (Google API の attendees から)
  attendee_emails     TEXT[] NOT NULL DEFAULT '{}',
  -- INTERCONNECT が組成した meeting (Meet auto-create 等) フラグ
  is_interconnect     BOOLEAN NOT NULL DEFAULT false,
  recording_enabled   BOOLEAN NOT NULL DEFAULT false,
  -- 内部 meetings との紐付け (任意)
  linked_meeting_id   UUID REFERENCES public.meetings(id) ON DELETE SET NULL,
  -- Google API ETag (差分同期用)
  etag                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_event_id)
);

-- ────────────────────────────────────────
-- 2) 検索用 index
-- ────────────────────────────────────────
-- user_id + start_at 降順 (週/月単位の絞り込みクエリの主用途)
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start
  ON public.calendar_events (user_id, start_at DESC);

-- connection 単位の差分同期で使う (sync worker)
CREATE INDEX IF NOT EXISTS idx_calendar_events_connection
  ON public.calendar_events (connection_id);

-- meeting 側からの逆引き (条件付き index で NULL を除外)
CREATE INDEX IF NOT EXISTS idx_calendar_events_linked_meeting
  ON public.calendar_events (linked_meeting_id)
  WHERE linked_meeting_id IS NOT NULL;

-- ────────────────────────────────────────
-- 3) updated_at 自動更新 trigger
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_calendar_events_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER tg_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_calendar_events_set_updated_at();

-- ────────────────────────────────────────
-- 4) RLS
-- ────────────────────────────────────────
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- service_role は全操作可 (sync worker / Webhook)
CREATE POLICY "service_role_calendar_events_full"
  ON public.calendar_events AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- authenticated user は自分の row だけ SELECT 可
CREATE POLICY "auth_select_own_calendar_events"
  ON public.calendar_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- UI 側からの直接 mutation は今のところ存在しない (Google API 経由で書く)
-- 将来追加する場合は INSERT/UPDATE/DELETE policy を追加

-- ────────────────────────────────────────
-- 5) コメント + schema cache reload
-- ────────────────────────────────────────
COMMENT ON TABLE public.calendar_events IS
  'Google Calendar 等から同期したイベント (00061)。 calendar_connections の子。'
  ' UI 表示は GET /api/v1/calendar/events 経由、書き込みは sync worker (service_role) のみ。';

NOTIFY pgrst, 'reload schema';
