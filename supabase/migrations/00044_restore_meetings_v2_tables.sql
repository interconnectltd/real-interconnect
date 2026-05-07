-- 00044: 00040 で誤って DROP した meeting_participants_v2 を復活
--
-- 経緯:
--   00040 のコメント「src 内 grep で参照ゼロ」は虚偽で、実際には src 7 ファイル
--   13 箇所で `.from("meeting_participants_v2")` を呼び出し中。
--   00040 適用済 → これらの API が 500 (relation does not exist) を返す。
--
-- 修正:
--   meeting_participants_v2 のみ復活 (meeting_threads / meeting_messages は別スキーマで
--   既に存在しているため touch しない)。データは消失済なので空テーブル。

CREATE TABLE IF NOT EXISTS public.meeting_participants_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role            TEXT DEFAULT 'participant',
  joined_at       TIMESTAMPTZ,
  left_at         TIMESTAMPTZ,
  UNIQUE(meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_v2_meeting ON public.meeting_participants_v2(meeting_id);
CREATE INDEX IF NOT EXISTS idx_mp_v2_user ON public.meeting_participants_v2(user_id);

ALTER TABLE public.meeting_participants_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_view_meeting_participants_v2 ON public.meeting_participants_v2;
CREATE POLICY auth_view_meeting_participants_v2
  ON public.meeting_participants_v2 FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

NOTIFY pgrst, 'reload schema';
