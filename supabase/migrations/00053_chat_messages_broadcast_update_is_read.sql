-- Wave13 #6/#9: 既読 realtime broadcast 拡張
--
-- 旧実装は migration 00031 で AFTER INSERT のみの broadcast trigger を持ち、
-- is_read=true への UPDATE では他 client に何も飛ばなかった。結果、
-- 「相手が読んだ瞬間に ✓ → ✓✓ が切り替わる」UX は実装されておらず、
-- 自分の画面では visibility 復帰 / scrollBottom invalidate / room 再 open まで
-- 反映しなかった (= polling まがいの UX)。
--
-- 本 migration は AFTER UPDATE OF is_read trigger を追加して、 既存の
-- broadcast topic 'chat:room:<room_id>' に 'UPDATE' event を流す。 UI 側は
-- chat-messages.tsx 側で .on("broadcast", { event: "UPDATE" }) を追加して
-- React Query キャッシュの該当 message を is_read=true に更新する。
--
-- INSERT trigger は無改変、 UPDATE trigger は是非。 同 SECURITY DEFINER + 同
-- search_path で副作用最小。

CREATE OR REPLACE FUNCTION public.broadcast_chat_message_update_is_read()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- is_read が false → true に変わった行のみ broadcast (false への戻し不可
  -- だが念のため厳密に一方向のみ通知)
  IF (OLD.is_read = false AND NEW.is_read = true) THEN
    PERFORM realtime.broadcast_changes(
      'chat:room:' || NEW.room_id::text,
      'UPDATE',
      'UPDATE',
      TG_TABLE_NAME,
      TG_TABLE_SCHEMA,
      NEW,
      OLD
    );
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'realtime.broadcast_changes unavailable, no-op';
    RETURN NEW;
  WHEN invalid_schema_name THEN
    RAISE NOTICE 'realtime schema unavailable, no-op';
    RETURN NEW;
  WHEN OTHERS THEN
    -- 既読更新自体は妨げない、 broadcast は best-effort
    RAISE NOTICE 'broadcast failed (non-fatal): %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_broadcast_update_trigger ON public.chat_messages;
CREATE TRIGGER chat_messages_broadcast_update_trigger
  AFTER UPDATE OF is_read ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_chat_message_update_is_read();

COMMENT ON FUNCTION public.broadcast_chat_message_update_is_read() IS
  'Wave13: is_read=true 更新時に chat:room:<id> private channel へ UPDATE event を broadcast。'
  'UI が ✓ → ✓✓ を realtime 反映するための trigger。';
