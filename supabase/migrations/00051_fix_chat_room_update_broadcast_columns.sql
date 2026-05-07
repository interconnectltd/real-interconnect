-- 00051: 00041 の broadcast_chat_room_update() で参照している
-- chat_rooms 列名が user_id / connected_user_id になっていたバグを修正。
--
-- 真実: chat_rooms の参加者列は user_a_id / user_b_id (00001/00004/00026 で確定)。
-- 00041 は SELECT user_id, connected_user_id FROM chat_rooms と書いていたため
-- AFTER INSERT trigger 内で `column "user_id" does not exist` (42703) が
-- 必ず発生し、chat_messages INSERT が rollback され API 500 になっていた。
--
-- 影響: chat の Send button (text) も日程調整 (scheduling_card) も
--       全 content_type で 500 を返していた。
--
-- 再現手順:
--   1) 任意 room で POST /api/v1/chat/rooms/{id}/messages { content: "x" }
--   2) DB: PL/pgSQL function broadcast_chat_room_update が AFTER INSERT で発火
--   3) SELECT user_id, connected_user_id ... が ERROR 42703 で失敗
--   4) trigger 全体 abort → INSERT rollback → route の `if (error) throw error;`
--      → handleApiError が 500 INTERNAL_ERROR に変換
--
-- 検証:
--   - `\d public.chat_rooms` で参加者列が user_a_id / user_b_id のみであることを確認
--   - 00031 の RLS policy も r.user_a_id / r.user_b_id を参照しており整合
--   - 00026/00027/00031 全てが user_a_id/user_b_id 表記。00041 の独自命名がバグ。

CREATE OR REPLACE FUNCTION public.broadcast_chat_room_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
BEGIN
  SELECT user_a_id, user_b_id
    INTO v_user_a, v_user_b
    FROM public.chat_rooms
   WHERE id = NEW.room_id;

  -- room が消えた直後の race などで NULL の場合は no-op
  IF v_user_a IS NULL THEN
    RETURN NEW;
  END IF;

  -- 双方の user 専用 channel に broadcast
  PERFORM realtime.send(
    jsonb_build_object('room_id', NEW.room_id, 'message_id', NEW.id),
    'ROOM_UPDATE',
    'chat:user:' || v_user_a::text,
    true
  );
  IF v_user_b IS NOT NULL AND v_user_b <> v_user_a THEN
    PERFORM realtime.send(
      jsonb_build_object('room_id', NEW.room_id, 'message_id', NEW.id),
      'ROOM_UPDATE',
      'chat:user:' || v_user_b::text,
      true
    );
  END IF;

  RETURN NEW;
EXCEPTION
  -- realtime.send が古い Supabase で未定義 / extension 不在等の場合に
  -- chat 本体機能を巻き込まないよう no-op fallback
  -- PostgreSQL spec: invalid_schema_name (3F000) / undefined_function (42883)
  WHEN undefined_function THEN
    RAISE NOTICE 'realtime.send unavailable, skip broadcast';
    RETURN NEW;
  WHEN invalid_schema_name THEN
    RAISE NOTICE 'realtime schema unavailable, skip broadcast';
    RETURN NEW;
  WHEN OTHERS THEN
    -- 想定外のエラーで chat 本体を巻き込まない (broadcast は best-effort)
    RAISE NOTICE 'broadcast_chat_room_update failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
