/**
 * POST /api/v1/chat/rooms/[roomId]/read
 *
 * 受信者が未読メッセージを read 化する。RLS の auth_update_recipient_read policy で
 * 「自分宛て (sender_id != auth.uid()) の room メッセージのみ」を更新可能。
 */

import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";

export async function POST(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { user, supabase } = await withAuth();
    const { roomId } = await context.params;
    if (!isValidUUID(roomId)) {
      return jsonError(400, "BAD_REQUEST", "ルーム ID が不正です");
    }

    // ルームメンバーシップ確認
    const { data: room } = await supabase
      .from("chat_rooms")
      .select("id, user_a_id, user_b_id")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) return jsonError(404, "NOT_FOUND", "ルームが存在しないかアクセス権がありません");
    if (room.user_a_id !== user.id && room.user_b_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "このルームのメンバーではありません");
    }

    const { error, count } = await supabase
      .from("chat_messages")
      .update({ is_read: true }, { count: "exact" })
      .eq("room_id", roomId)
      .neq("sender_id", user.id)
      .eq("is_read", false);

    if (error) throw error;
    return json({ updated: count ?? 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
