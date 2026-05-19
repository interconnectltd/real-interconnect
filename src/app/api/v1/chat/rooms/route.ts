/**
 * GET  /api/v1/chat/rooms
 * POST /api/v1/chat/rooms
 *
 * R2 改修:
 *   - GET の serviceClient (RLS bypass) を撤廃 → authenticated client + RLS で十分 (Arch R1: 過剰特権)
 *   - last_message.sender_id の "" 嘘データを廃止し、chat_rooms.last_message_sender_id を返却 (Arch R1)
 *   - last_message_content_type も同梱 (UI 側で「📅日程提案」等のラベル分岐に使用)
 *   - audit-log chat.room.create
 *
 * 既存仕様維持:
 *   - 認証ユーザーが user_a / user_b の room のみ取得 (RLS で保証)
 *   - unread_count を集計
 *   - other_user として相手プロフィールを enrich
 */

import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    // RLS で auth.uid() が user_a/user_b の room のみ取得可能
    const { data: rooms, error } = await supabase
      .from("chat_rooms")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .abortSignal(request.signal);

    if (error) throw error;
    if (!rooms || rooms.length === 0) return json([]);

    // Collect other user IDs
    const otherUserIds = rooms.map((r) =>
      r.user_a_id === user.id ? r.user_b_id : r.user_a_id,
    );

    // R5 Arch: serviceClient 撤廃。
    // user_profiles の auth_select_connected_profiles policy (00029) で
    // 相互 connection 経由のみ SELECT 可、authenticated client で十分
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, name, company, avatar_url, is_agency")
      .in("id", otherUserIds)
      .abortSignal(request.signal);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

    // unread_count: RPC (SECURITY DEFINER + GROUP BY) で N+1 を解消
    const { data: unreadRows } = await supabase
      .rpc("get_unread_counts")
      .abortSignal(request.signal);
    const unreadMap = new Map<string, number>();
    for (const row of unreadRows ?? []) {
      unreadMap.set(row.room_id, Number(row.unread_count));
    }

    const enriched = rooms.map((r) => ({
      ...r,
      other_user:
        profileMap.get(
          r.user_a_id === user.id ? r.user_b_id : r.user_a_id,
        ) ?? null,
      unread_count: unreadMap.get(r.id) ?? 0,
      last_message: r.last_message_at
        ? {
            content: r.last_message_preview ?? "",
            content_type: r.last_message_content_type ?? "text",
            created_at: r.last_message_at,
            sender_id: r.last_message_sender_id ?? null,
          }
        : null,
    }));

    return json(enriched);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "リクエストボディが不正です");
    }

    const { connection_id } = body as { connection_id?: unknown };

    if (
      typeof connection_id !== "string" ||
      !isValidUUID(connection_id)
    ) {
      return jsonError(400, "BAD_REQUEST", "有効なコネクションIDが必要です");
    }

    const { data: connection, error: connError } = await supabase
      .from("connections")
      .select("id, user_id, connected_user_id, status")
      .eq("id", connection_id)
      .or(`user_id.eq.${user.id},connected_user_id.eq.${user.id}`)
      .maybeSingle();

    if (connError) throw connError;

    if (!connection) {
      return jsonError(404, "NOT_FOUND", "コネクションが見つかりません");
    }

    if (
      connection.status !== "accepted" &&
      connection.status !== "reaccepted"
    ) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "承認済みのコネクションのみチャットルームを作成できます",
      );
    }

    // Check no existing room for this connection
    const serviceClient = await createServiceClient();
    const { data: existing } = await serviceClient
      .from("chat_rooms")
      .select("id")
      .eq("connection_id", connection_id)
      .maybeSingle();

    if (existing) {
      return jsonError(
        409,
        "CONFLICT",
        "このコネクションのチャットルームは既に存在します",
      );
    }

    const userAId = connection.user_id;
    const userBId = connection.connected_user_id;

    const { data: room, error: insertError } = await serviceClient
      .from("chat_rooms")
      .insert({
        connection_id,
        user_a_id: userAId,
        user_b_id: userBId,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // audit-log
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "chat.room.create",
      target_type: "chat_room",
      target_id: room?.id ?? null,
      payload: { connection_id, peer_user_id: userBId === user.id ? userAId : userBId },
      ip: client.ip,
      ua: client.ua,
    });

    return json(room, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
