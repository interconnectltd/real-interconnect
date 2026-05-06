-- 00026_chat_messages.sql
--
-- Chat 機能の DB schema。Frontend (chat/page.tsx + Realtime subscription) は完成済だが
-- backend テーブル + API が未実装で未稼働だった (R4 audit 由来)。
-- 既存 src/types/database.ts の型定義に合わせて作成。
--
-- 1. chat_rooms: 双方接続済 connection 1:1 で 1 room
-- 2. chat_messages: 各 room のメッセージ (text / image / file / scheduling_card 等)
-- 3. chat_analysis: 将来 Opus による会話分析結果 (現状 placeholder)
-- 4. RLS: user_a_id / user_b_id どちらかが auth.uid() のとき access 可
-- 5. Realtime publication: chat_messages を Supabase Realtime に追加

-- ────────────────────────────────────────
-- 1) chat_rooms
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  user_a_id             UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  user_b_id             UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_rooms_user_pair_check CHECK (user_a_id <> user_b_id),
  CONSTRAINT chat_rooms_connection_unique UNIQUE (connection_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_a ON public.chat_rooms(user_a_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_b ON public.chat_rooms(user_b_id, last_message_at DESC NULLS LAST);

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_chat_rooms_full"
  ON public.chat_rooms AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_select_own_chat_rooms"
  ON public.chat_rooms AS PERMISSIVE FOR SELECT TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- ────────────────────────────────────────
-- 2) chat_messages
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  content       TEXT NOT NULL CHECK (char_length(content) <= 4000),
  content_type  TEXT NOT NULL DEFAULT 'text'
                CHECK (content_type IN ('text', 'image', 'file', 'scheduling_card', 'meeting_suggestion', 'meeting_confirmed')),
  is_read       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON public.chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON public.chat_messages(room_id, sender_id)
  WHERE is_read = false;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_chat_messages_full"
  ON public.chat_messages AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 認証ユーザーは自分が user_a/user_b の room のメッセージだけ SELECT
CREATE POLICY "auth_select_own_room_messages"
  ON public.chat_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_rooms r
       WHERE r.id = room_id
         AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
    )
  );

-- INSERT は自分が sender でかつ自分の room のみ
CREATE POLICY "auth_insert_own_room_messages"
  ON public.chat_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms r
       WHERE r.id = room_id
         AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
    )
  );

-- UPDATE は is_read を相手側だけが更新可 (自分が受信側)
CREATE POLICY "auth_update_recipient_read"
  ON public.chat_messages AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms r
       WHERE r.id = room_id
         AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
    )
  )
  WITH CHECK (
    sender_id <> auth.uid()
  );

-- ────────────────────────────────────────
-- 3) chat_analysis (placeholder for future Opus analysis)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_analysis (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  analyzed_up_to_id   UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  extracted_topics    JSONB NOT NULL DEFAULT '[]',
  extracted_needs     JSONB NOT NULL DEFAULT '[]',
  extracted_offers    JSONB NOT NULL DEFAULT '[]',
  engagement_signals  JSONB NOT NULL DEFAULT '{}',
  analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_chat_analysis_full"
  ON public.chat_analysis AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────
-- 4) Realtime publication
-- ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

-- ────────────────────────────────────────
-- 5) UPDATE trigger: chat_messages insert で chat_rooms.last_message_* を更新
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_chat_room_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chat_rooms
     SET last_message_at = NEW.created_at,
         last_message_preview = LEFT(NEW.content, 100)
   WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_update_room_trigger ON public.chat_messages;
CREATE TRIGGER chat_messages_update_room_trigger
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_chat_room_last_message();
