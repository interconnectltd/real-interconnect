/**
 * GET  /api/v1/chat/rooms/[roomId]/messages
 * POST /api/v1/chat/rooms/[roomId]/messages
 *
 * チャットルームのメッセージ取得・送信。
 *
 * R2 改修 (5 観点並列レビュー指摘反映):
 *   - Zod validation で body/query 全フィールド型保証 (TS R1: body:any 解消)
 *   - cursor pagination tie-break: (created_at, id) 複合 + limit+1 fetch
 *   - response shape: { messages, next_cursor, has_more } で UI 互換 (FE R1: shape 不一致)
 *   - SSOT: ChatContentType を src/types/chat.ts から派生 (TS R1: SSOT 違反解消)
 *   - rate-limit: chat 専用 30 req/min (POST) / 120 req/min (GET) (Sec R1: rate-limit 欠落)
 *   - audit-log: chat.message.send / chat.message.read 記録 (Sec R1: 監査全欠落)
 *   - payload JSONB 受領 (Phase B 準備、scheduling_card 等の構造化対応)
 *
 * RLS:
 *   chat_rooms の user_a_id / user_b_id どちらかが auth.uid() のときのみ
 *   access 可。事前 explicit check で UX 改善 + RLS で defense-in-depth。
 *
 * 列改竄防止:
 *   migration 00027 の enforce_chat_message_immutable trigger で
 *   is_read 以外の UPDATE は物理拒否。
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
import {
  PostMessageSchema,
  GetMessagesQuerySchema,
} from "@/lib/validators/chat";
import type { ChatMessagesResponse, ChatMessage } from "@/types/chat";
import type { Json } from "@/types/database";

const RL_GET_MAX = 120;
const RL_POST_MAX = 30;

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { user, supabase } = await withAuth(request, { skipMemoryRl: true });
    const { roomId } = await context.params;
    if (!isValidUUID(roomId)) {
      return jsonError(400, "BAD_REQUEST", "ルーム ID が不正です");
    }

    // DB-backed rate limit (multi-instance 分散対応, 真の sliding window)
    const allowed = await checkDbRateLimit(
      supabase,
      user.id,
      "chat.msg.get",
      RL_GET_MAX,
      60,
    );
    if (!allowed) {
      return jsonError(429, "RATE_LIMITED", "リクエストが多すぎます");
    }

    const url = new URL(request.url);
    const queryParse = GetMessagesQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      before_at: url.searchParams.get("before_at") ?? undefined,
      before_id: url.searchParams.get("before_id") ?? undefined,
    });
    if (!queryParse.success) {
      return jsonError(400, "BAD_REQUEST", queryParse.error.message);
    }
    const { limit, before_at, before_id } = queryParse.data;

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

    // limit+1 fetch で has_more 厳密判定
    let q = supabase
      .from("chat_messages")
      .select(
        "id, room_id, sender_id, content, content_type, payload, is_read, created_at",
      )
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .abortSignal(request.signal)
      .limit(limit + 1);

    // cursor: created_at < before_at OR (created_at = before_at AND id < before_id)
    if (before_at && before_id) {
      // PostgREST の複合条件: .or() で表現
      q = q.or(
        `created_at.lt.${before_at},and(created_at.eq.${before_at},id.lt.${before_id})`,
      );
    } else if (before_at) {
      q = q.lt("created_at", before_at);
    }

    const { data: rawMessages, error } = await q;
    if (error) throw error;

    const all = rawMessages ?? [];
    const hasMore = all.length > limit;
    const trimmed = hasMore ? all.slice(0, limit) : all;

    // 古い順で返す (UI が下から積む前提)
    const ordered = [...trimmed].reverse() as ChatMessage[];

    const oldest = ordered[0];
    const next_cursor =
      hasMore && oldest
        ? JSON.stringify({ at: oldest.created_at, id: oldest.id })
        : null;

    const response: ChatMessagesResponse = {
      messages: ordered,
      next_cursor,
      has_more: hasMore,
    };
    return json(response);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { user, supabase } = await withAuth(request, { skipMemoryRl: true });
    const { roomId } = await context.params;
    if (!isValidUUID(roomId)) {
      return jsonError(400, "BAD_REQUEST", "ルーム ID が不正です");
    }

    // DB-backed rate limit (multi-instance 分散対応, 真の sliding window)
    const allowed = await checkDbRateLimit(
      supabase,
      user.id,
      "chat.msg.post",
      RL_POST_MAX,
      60,
    );
    if (!allowed) {
      return jsonError(429, "RATE_LIMITED", "送信が多すぎます。少し待ってください");
    }

    // Idempotency-Key (R3 Arch: client retry 二重 INSERT 防止)
    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey) {
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return jsonError(
          400,
          "BAD_REQUEST",
          "Idempotency-Key は 8〜128 文字",
        );
      }
      // 既存 key check (2 step: key→message_id→message)
      const { data: idemRow } = await supabase
        .from("chat_message_idempotency_keys")
        .select("message_id")
        .eq("user_id", user.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (idemRow?.message_id) {
        const { data: prevMsg } = await supabase
          .from("chat_messages")
          .select(
            "id, room_id, sender_id, content, content_type, payload, is_read, created_at",
          )
          .eq("id", idemRow.message_id)
          .maybeSingle();
        if (prevMsg) {
          // 同 key の以前の message を返却 (idempotent)
          return json(prevMsg, 200);
        }
      }
    }

    // Zod validation で body 全フィールド型保証
    const raw: unknown = await request.json().catch(() => null);
    const parsed = PostMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "リクエストボディが不正です",
      );
    }
    const { content, content_type, payload } = parsed.data;

    // Membership check (RLS でも保証されるが先に明示エラー)
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

    const insertPayload = {
      room_id: roomId,
      sender_id: user.id,
      content,
      content_type,
      ...(payload !== undefined && payload !== null
        ? { payload: payload as Json }
        : {}),
    };

    const { data: message, error } = await supabase
      .from("chat_messages")
      .insert(insertPayload)
      .select(
        "id, room_id, sender_id, content, content_type, payload, is_read, created_at",
      )
      .single();

    if (error) throw error;

    // Idempotency-Key 記録 (best-effort、既存 key は 23505 で skip)
    if (idempotencyKey && message) {
      await supabase
        .from("chat_message_idempotency_keys")
        .insert({
          user_id: user.id,
          idempotency_key: idempotencyKey,
          message_id: message.id,
        })
        .then(({ error: idemErr }) => {
          if (idemErr && idemErr.code !== "23505") {
            console.warn("[idem] insert failed:", idemErr.message);
          }
        });
    }

    // audit-log (best-effort)
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "chat.message.send",
      target_type: "chat_message",
      target_id: message?.id ?? null,
      payload: {
        room_id: roomId,
        content_type,
        len: content.length,
        idempotent: idempotencyKey ? true : false,
      },
      ip: client.ip,
      ua: client.ua,
    });

    return json(message, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
