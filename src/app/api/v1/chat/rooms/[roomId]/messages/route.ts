/**
 * GET /api/v1/chat/rooms/[roomId]/messages
 * POST /api/v1/chat/rooms/[roomId]/messages
 *
 * チャットルームのメッセージ取得・送信。
 *   - GET: 直近 N 件を時系列降順で返す (cursor pagination 対応)
 *   - POST: 新規メッセージを書き込み、Supabase Realtime で相手に push
 *
 * RLS: chat_rooms の user_a_id / user_b_id どちらかが auth.uid() のときのみ
 *      access 可 (migration 00026)。本ルートは withAuth() + auth client で
 *      RLS に従って動作する。
 */

import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";

const MAX_PAGE = 50;
const MAX_CONTENT_LEN = 4000;
const VALID_CONTENT_TYPES = new Set([
  "text",
  "image",
  "file",
  "scheduling_card",
  "meeting_suggestion",
  "meeting_confirmed",
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { user, supabase } = await withAuth();
    const { roomId } = await context.params;
    if (!isValidUUID(roomId)) {
      return jsonError(400, "BAD_REQUEST", "ルーム ID が不正です");
    }

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 30), MAX_PAGE));
    const before = url.searchParams.get("before"); // ISO timestamp for pagination

    // RLS が user_a/user_b 以外をブロック。事前 explicit check で UX が良いエラー
    const { data: room } = await supabase
      .from("chat_rooms")
      .select("id, user_a_id, user_b_id")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) return jsonError(404, "NOT_FOUND", "ルームが存在しないかアクセス権がありません");
    if (room.user_a_id !== user.id && room.user_b_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "このルームのメンバーではありません");
    }

    let q = supabase
      .from("chat_messages")
      .select("id, room_id, sender_id, content, content_type, is_read, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) q = q.lt("created_at", before);

    const { data: messages, error } = await q;
    if (error) throw error;

    // 古い順で返す (UI が下から積む前提)
    return json({
      messages: (messages ?? []).reverse(),
      has_more: (messages?.length ?? 0) >= limit,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { user, supabase } = await withAuth();
    const { roomId } = await context.params;
    if (!isValidUUID(roomId)) {
      return jsonError(400, "BAD_REQUEST", "ルーム ID が不正です");
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "リクエストボディが不正です");
    }

    const content = typeof body.content === "string" ? body.content.trim() : "";
    type ContentType = "text" | "image" | "file" | "scheduling_card" | "meeting_suggestion" | "meeting_confirmed";
    const rawContentType = (body.content_type as string) ?? "text";

    if (!content) return jsonError(400, "BAD_REQUEST", "本文が空です");
    if (content.length > MAX_CONTENT_LEN) {
      return jsonError(400, "BAD_REQUEST", `本文は ${MAX_CONTENT_LEN} 文字以内です`);
    }
    if (!VALID_CONTENT_TYPES.has(rawContentType)) {
      return jsonError(400, "BAD_REQUEST", "content_type が不正です");
    }
    const contentType = rawContentType as ContentType;

    // ルームメンバーシップ確認 (RLS でも保証されるが事前チェック)
    const { data: room } = await supabase
      .from("chat_rooms")
      .select("id, user_a_id, user_b_id")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) return jsonError(404, "NOT_FOUND", "ルームが存在しないかアクセス権がありません");
    if (room.user_a_id !== user.id && room.user_b_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "このルームのメンバーではありません");
    }

    const { data: message, error } = await supabase
      .from("chat_messages")
      .insert({
        room_id: roomId,
        sender_id: user.id,
        content,
        content_type: contentType,
      })
      .select("id, room_id, sender_id, content, content_type, is_read, created_at")
      .single();

    if (error) throw error;
    return json(message, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
