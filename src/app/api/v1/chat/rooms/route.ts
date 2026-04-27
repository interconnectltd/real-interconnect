import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { user } = await withAuth();
    const serviceClient = await createServiceClient();

    // Fetch chat rooms where user is either side
    const { data: rooms, error } = await serviceClient
      .from("chat_rooms")
      .select("*")
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) throw error;
    if (!rooms || rooms.length === 0) return json([]);

    // Collect other user IDs and fetch profiles
    const otherUserIds = rooms.map((r) =>
      r.user_a_id === user.id ? r.user_b_id : r.user_a_id,
    );
    const { data: profiles } = await serviceClient
      .from("user_profiles")
      .select("id, name, company, avatar_url")
      .in("id", otherUserIds);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

    // Fetch unread counts per room (messages not sent by current user and unread)
    const roomIds = rooms.map((r) => r.id);
    const { data: unreadRows } = await serviceClient
      .from("chat_messages")
      .select("room_id")
      .in("room_id", roomIds)
      .neq("sender_id", user.id)
      .eq("is_read", false);

    const unreadMap = new Map<string, number>();
    for (const row of unreadRows ?? []) {
      unreadMap.set(row.room_id, (unreadMap.get(row.room_id) ?? 0) + 1);
    }

    const enriched = rooms.map((r) => ({
      ...r,
      other_user: profileMap.get(
        r.user_a_id === user.id ? r.user_b_id : r.user_a_id,
      ) ?? null,
      unread_count: unreadMap.get(r.id) ?? 0,
      last_message: r.last_message_at
        ? {
            content: r.last_message_preview ?? "",
            created_at: r.last_message_at,
            sender_id: "",
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
    const { user, supabase } = await withAuth();
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "リクエストボディが不正です");
    }

    const { connection_id } = body;

    if (!connection_id || !isValidUUID(connection_id)) {
      return jsonError(400, "BAD_REQUEST", "有効なコネクションIDが必要です");
    }

    // Verify the connection exists and is accepted/reaccepted
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

    if (connection.status !== "accepted" && connection.status !== "reaccepted") {
      return jsonError(400, "BAD_REQUEST", "承認済みのコネクションのみチャットルームを作成できます");
    }

    // Check no existing room for this connection
    const serviceClient = await createServiceClient();
    const { data: existing } = await serviceClient
      .from("chat_rooms")
      .select("id")
      .eq("connection_id", connection_id)
      .maybeSingle();

    if (existing) {
      return jsonError(409, "CONFLICT", "このコネクションのチャットルームは既に存在します");
    }

    // Determine user_a and user_b
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

    return json(room, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
