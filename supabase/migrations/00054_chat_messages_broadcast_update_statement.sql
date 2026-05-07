-- Wave13 R2 #2: 既読 broadcast 嵐 (broadcast storm) 防止
--
-- 00053 で AFTER UPDATE OF is_read FOR EACH ROW trigger を導入したが、
-- /chat/rooms/[id]/read API は room 内の全 unread メッセージを 1 回の bulk UPDATE
-- で is_read=true に切り替える。 100 件 unread ある room を初開封すると:
--   - 100 行 UPDATE → 100 回 trigger 発火 → 100 broadcast event
--   - client 側 .on("broadcast", { event: "UPDATE" }) が 100 回呼ばれる
--   - 各 callback で React Query setQueryData が messages.map 線形スキャン
--   → O(N²) 走査 + 100 re-render + Supabase channel 100msg/s rate-limit 抵触
--
-- 本 migration は AFTER UPDATE OF is_read FOR EACH STATEMENT trigger に切替、
-- REFERENCING NEW TABLE で更新行を 1 broadcast event にまとめて送出する。
-- payload 形: { event: 'UPDATE_BULK', payload: { ids: [...], is_read: true } }
-- client は単発 callback で全 ID 一括 setQueryData → 1 re-render に圧縮。

-- 旧 ROW trigger を撤去
DROP TRIGGER IF EXISTS chat_messages_broadcast_update_trigger ON public.chat_messages;
DROP FUNCTION IF EXISTS public.broadcast_chat_message_update_is_read();

CREATE OR REPLACE FUNCTION public.broadcast_chat_message_update_is_read_stmt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rooms RECORD;
BEGIN
  -- 同 statement で複数 room の更新が混ざるケース (= read API は room_id 限定なので
  -- 通常起きない) も room ごとに別 broadcast でまとめる。
  FOR v_rooms IN
    SELECT
      n.room_id,
      array_agg(n.id ORDER BY n.created_at) AS ids
    FROM new_rows n
    INNER JOIN old_rows o ON o.id = n.id
    WHERE n.is_read = true
      AND o.is_read = false
    GROUP BY n.room_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'ids', to_jsonb(v_rooms.ids),
        'is_read', true
      ),
      'UPDATE_BULK',
      'chat:room:' || v_rooms.room_id::text,
      true
    );
  END LOOP;
  RETURN NULL;
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'realtime.send unavailable, no-op';
    RETURN NULL;
  WHEN invalid_schema_name THEN
    RAISE NOTICE 'realtime schema unavailable, no-op';
    RETURN NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'broadcast_update_stmt failed (non-fatal): %', SQLERRM;
    RETURN NULL;
END;
$$;

-- PostgreSQL 制約: REFERENCING NEW/OLD TABLE は OF column_list と併用不可。
-- OF is_read を撤去してトリガー関数側で is_read 切替のみ抽出する条件にしてある。
CREATE TRIGGER chat_messages_broadcast_update_stmt_trigger
  AFTER UPDATE ON public.chat_messages
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.broadcast_chat_message_update_is_read_stmt();

COMMENT ON FUNCTION public.broadcast_chat_message_update_is_read_stmt() IS
  'Wave13 R2: bulk UPDATE 時の broadcast 嵐を防止する STATEMENT trigger。'
  'room_id ごとに 1 broadcast event に集約 (UPDATE_BULK) して送出。';
