-- Wave13 R3 #9: UPDATE_BULK broadcast の payload size cap
--
-- 00054 で AFTER UPDATE STATEMENT trigger に切替済だが、 「半年放置 room を初開封」
-- 等の edge case で 10000 件 unread = 約 400 KB の ids 配列を 1 broadcast で送出 →
-- Supabase Realtime の 256 KB / message 制約に引っかかり broadcast 自体が drop。
-- 結果、 client 側で既読化 UI が反映されない silent failure。
--
-- 本 migration は trigger 関数を更新し、 ids 配列が 500 件を超える時は
-- ids を含めず count + overflow=true のみ送出する UPDATE_BULK_OVERFLOW event に
-- 切替える。 client 側は overflow を検知したら React Query の invalidateQueries を
-- 強制実行して最新状態を refetch する fallback で正準化。

CREATE OR REPLACE FUNCTION public.broadcast_chat_message_update_is_read_stmt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rooms RECORD;
  v_count INT;
  v_overflow_threshold CONSTANT INT := 500;  -- ids 配列の上限
BEGIN
  -- 早期 return: is_read=false→true 変化 0 件なら何もしない (大量 INSERT 時の
  -- 無駄発火 cost 抑制)
  IF NOT EXISTS (
    SELECT 1 FROM new_rows n
    INNER JOIN old_rows o ON o.id = n.id
    WHERE n.is_read = true AND o.is_read = false
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  FOR v_rooms IN
    SELECT
      n.room_id,
      array_agg(n.id ORDER BY n.created_at) AS ids,
      count(*) AS cnt
    FROM new_rows n
    INNER JOIN old_rows o ON o.id = n.id
    WHERE n.is_read = true
      AND o.is_read = false
    GROUP BY n.room_id
  LOOP
    v_count := v_rooms.cnt;
    IF v_count > v_overflow_threshold THEN
      -- 上限超: ids 含めず client に invalidate fallback を促す
      PERFORM realtime.send(
        jsonb_build_object(
          'count', v_count,
          'is_read', true,
          'overflow', true
        ),
        'UPDATE_BULK_OVERFLOW',
        'chat:room:' || v_rooms.room_id::text,
        true
      );
    ELSE
      PERFORM realtime.send(
        jsonb_build_object(
          'ids', to_jsonb(v_rooms.ids),
          'is_read', true,
          'count', v_count
        ),
        'UPDATE_BULK',
        'chat:room:' || v_rooms.room_id::text,
        true
      );
    END IF;
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

COMMENT ON FUNCTION public.broadcast_chat_message_update_is_read_stmt() IS
  'Wave13 R3: 500 件超の bulk UPDATE は UPDATE_BULK_OVERFLOW event に切替えて'
  '256 KB payload 上限超過を防止。 client は overflow 受信時 invalidateQueries 強制。';
