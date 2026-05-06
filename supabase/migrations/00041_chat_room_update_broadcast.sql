-- 00041: chat_messages INSERT 時に room 一覧側 broadcast trigger
--
-- 目的:
--   chat-rooms 一覧の last_message / unread_count / sort 順を
--   別 room の新着で即時更新するため、user 専用 private channel
--   `chat:user:${user_id}` に "ROOM_UPDATE" event を broadcast する。
--
-- 受信側: src/app/(auth)/chat/page.tsx の useEffect で購読済 (commit 8091e95)
--
-- 設計判断:
--   - room の participants (user_id, connected_user_id) 双方に通知
--   - 自分が送信した場合も自分側の sort 順更新のために broadcast (本人にも届く)
--   - chat:user:${user_id} は private:true → realtime.messages RLS で
--     `topic = 'chat:user:' || auth.uid()::text` のみ受信可

CREATE OR REPLACE FUNCTION public.broadcast_chat_room_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_room_user UUID;
  v_room_connected UUID;
BEGIN
  SELECT user_id, connected_user_id
    INTO v_room_user, v_room_connected
    FROM public.chat_rooms
   WHERE id = NEW.room_id;
  IF v_room_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- 双方の user 専用 channel に broadcast
  PERFORM realtime.send(
    jsonb_build_object('room_id', NEW.room_id, 'message_id', NEW.id),
    'ROOM_UPDATE',
    'chat:user:' || v_room_user::text,
    true
  );
  IF v_room_connected IS NOT NULL AND v_room_connected <> v_room_user THEN
    PERFORM realtime.send(
      jsonb_build_object('room_id', NEW.room_id, 'message_id', NEW.id),
      'ROOM_UPDATE',
      'chat:user:' || v_room_connected::text,
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_update_broadcast ON public.chat_messages;
CREATE TRIGGER chat_room_update_broadcast
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_chat_room_update();

NOTIFY pgrst, 'reload schema';
