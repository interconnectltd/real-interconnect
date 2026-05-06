-- 00031_chat_realtime_authorization.sql
--
-- Sec R3 で指摘された致命:
--   「Supabase Realtime publication は既定で全 row broadcast、RLS を尊重しない。
--    別 room メッセージが全購読者に物理漏洩する」
--
-- 対策: Supabase Realtime Authorization (2024.9 GA) を有効化。
--   - publication ベース postgres_changes は維持しつつ
--   - realtime.messages テーブルへの RLS policy で
--     "private channel" 購読時にメンバーシップ検証
--   - クライアントは `channel('chat:room:<id>', { config: { private: true } })`
--     で subscribe する必要がある (UI 側で対応)
--
-- 公式: https://supabase.com/docs/guides/realtime/authorization

-- ────────────────────────────────────────
-- 1) Realtime extension 有効化確認
-- ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "supabase_realtime" SCHEMA extensions;

-- ────────────────────────────────────────
-- 2) realtime.messages テーブル (Supabase 内部) への RLS policy
--    - SELECT (subscribe): 自分が user_a/user_b の room の topic のみ
--    - INSERT (broadcast): admin/service_role のみ (クライアントから直送禁止)
--
--    topic 形式: 'chat:room:<UUID>'
-- ────────────────────────────────────────

-- realtime schema は Supabase が管理。RLS は ALTER で有効化
-- (既に enabled だが念のため)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='realtime' AND tablename='messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- 既存 policy を一旦削除 (再適用安全)
DROP POLICY IF EXISTS "chat_room_authorize_subscribe" ON realtime.messages;
DROP POLICY IF EXISTS "chat_room_authorize_broadcast" ON realtime.messages;

-- ────────────────────────────────────────
-- 3) SELECT policy: 自分のメンバー room の topic のみ subscribe 可
-- ────────────────────────────────────────
CREATE POLICY "chat_room_authorize_subscribe"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    -- topic が 'chat:room:<UUID>' 形式で、自分がそのメンバーなら許可
    CASE
      WHEN realtime.topic() LIKE 'chat:room:%' THEN
        EXISTS (
          SELECT 1
            FROM public.chat_rooms r
           WHERE r.id::text = substring(realtime.topic() FROM 'chat:room:(.+)')
             AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
        )
      ELSE false
    END
  );

-- ────────────────────────────────────────
-- 4) INSERT (broadcast) policy: 認証ユーザーは自分が member の room にのみ送信可
--    (typing indicator / presence 用、message 本体は SQL trigger で自動配信)
-- ────────────────────────────────────────
CREATE POLICY "chat_room_authorize_broadcast"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN realtime.topic() LIKE 'chat:room:%' THEN
        EXISTS (
          SELECT 1
            FROM public.chat_rooms r
           WHERE r.id::text = substring(realtime.topic() FROM 'chat:room:(.+)')
             AND (r.user_a_id = auth.uid() OR r.user_b_id = auth.uid())
        )
      ELSE false
    END
  );

-- ────────────────────────────────────────
-- 5) chat_messages INSERT 時 trigger で private channel に broadcast
--    既存 publication ベースの postgres_changes も並行して動くが、
--    UI 側を private:true subscribe に切替後はこちらが主経路
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.broadcast_chat_message_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- realtime.broadcast_changes() を topic 'chat:room:<room_id>' に流す
  -- 形式: { event: 'INSERT', payload: { record: {...}, table: 'chat_messages' } }
  PERFORM realtime.broadcast_changes(
    'chat:room:' || NEW.room_id::text,    -- topic
    TG_OP,                                 -- event ('INSERT')
    TG_OP,                                 -- operation
    TG_TABLE_NAME,                         -- table
    TG_TABLE_SCHEMA,                       -- schema
    NEW,                                   -- new record
    NULL                                   -- old record (INSERT なので NULL)
  );
  RETURN NEW;
EXCEPTION
  WHEN undefined_function THEN
    -- realtime.broadcast_changes が無い古い Supabase は no-op
    RAISE NOTICE 'realtime.broadcast_changes unavailable, falling back to publication';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_broadcast_trigger ON public.chat_messages;
CREATE TRIGGER chat_messages_broadcast_trigger
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_chat_message_insert();

-- ────────────────────────────────────────
-- 6) (任意) publication からの除外を後で行う場合の note
--    本 migration では publication ベース postgres_changes も維持。
--    UI 側を完全に private channel に切替後、別 migration で
--    `ALTER PUBLICATION supabase_realtime DROP TABLE chat_messages` で除外可。
-- ────────────────────────────────────────
