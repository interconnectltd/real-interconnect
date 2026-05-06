/**
 * POST /api/v1/chat/rooms/[roomId]/read
 *
 * 受信者が未読メッセージを read 化する。
 *
 * R2 改修:
 *   - body に { up_to_message_id?: UUID } を受け、範囲限定 update 可能 (Arch R1: 全更新 redundant write)
 *   - rate-limit 60 req/min (Sec R1)
 *   - audit-log chat.message.read (Sec R1)
 *
 * RLS:
 *   auth_update_recipient_read policy + enforce_chat_message_immutable trigger で
 *   sender_id != auth.uid() の room メッセージの is_read のみ true 化可能。
 *   他列の改竄は trigger が物理拒否。
 */

import {
  withAuth,
  json,
  jsonError,
  handleApiError,
  checkDbRateLimit,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { ReadSchema } from "@/lib/validators/chat";

const RL_MAX = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { user, supabase } = await withAuth(request, {
      skipMemoryRl: true,
      burstLimit: { perSecond: 10 },
    });
    const { roomId } = await context.params;
    if (!isValidUUID(roomId)) {
      return jsonError(400, "BAD_REQUEST", "ルーム ID が不正です");
    }

    const allowed = await checkDbRateLimit(
      supabase,
      user.id,
      "chat.msg.read",
      RL_MAX,
      60,
      true, // fail-closed
    );
    if (!allowed) {
      return jsonError(429, "RATE_LIMITED", "リクエストが多すぎます");
    }

    // body は optional (空でも OK)
    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = ReadSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディが不正です",
      );
    }
    const { up_to_message_id } = parsed.data;

    // Membership check
    const { data: room } = await supabase
      .from("chat_rooms")
      .select("id, user_a_id, user_b_id")
      .eq("id", roomId)
      .abortSignal(request.signal)
      .maybeSingle();
    if (!room) {
      return jsonError(
        404,
        "NOT_FOUND",
        "ルームが存在しないかアクセス権がありません",
      );
    }
    if (room.user_a_id !== user.id && room.user_b_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "このルームのメンバーではありません");
    }

    // 範囲限定: up_to_message_id 指定時はその created_at <= 以下のみ更新
    let upToCreatedAt: string | null = null;
    if (up_to_message_id) {
      const { data: upToMsg } = await supabase
        .from("chat_messages")
        .select("created_at")
        .eq("id", up_to_message_id)
        .eq("room_id", roomId)
        .maybeSingle();
      if (upToMsg) upToCreatedAt = upToMsg.created_at;
    }

    let updateQ = supabase
      .from("chat_messages")
      .update({ is_read: true }, { count: "exact" })
      .eq("room_id", roomId)
      .neq("sender_id", user.id)
      .eq("is_read", false);

    if (upToCreatedAt) {
      updateQ = updateQ.lte("created_at", upToCreatedAt);
    }

    const { error, count } = await updateQ;
    if (error) throw error;

    // audit-log
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "chat.message.read",
      target_type: "chat_room",
      target_id: roomId,
      payload: {
        updated_count: count ?? 0,
        up_to_message_id: up_to_message_id ?? null,
      },
      ip: client.ip,
      ua: client.ua,
    });

    return json({ updated: count ?? 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
