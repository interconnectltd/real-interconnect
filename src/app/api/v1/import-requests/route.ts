/**
 * GET  /api/v1/import-requests           - 自分の申請履歴
 * POST /api/v1/import-requests           - 新規申請
 *
 * 会議データ取込申請。tl:dv 等の会議データを INTER CONNECT に取り込んでほしい
 * とユーザーが運営に申請する。pending は1ユーザー1件まで (UNIQUE 制約)。
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { isValidUUID } from "@/lib/sanitize";

const PostSchema = z.object({
  message: z.string().trim().max(1000).optional().nullable(),
  source: z.enum(["tldv", "manual_csv", "other"]).default("tldv"),
});

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    type RpcLoose = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    // RPC で COUNT(DISTINCT) を SQL 側で完結させる (旧実装は全件転送で payload 肥大)
    const [reqRes, countRes] = await Promise.all([
      supabase
        .from("meeting_data_import_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .abortSignal(request.signal),
      (supabase as unknown as RpcLoose).rpc("user_linked_meetings_count", {
        p_user_id: user.id,
      }),
    ]);
    if (reqRes.error) throw reqRes.error;

    const linkedMeetings = typeof countRes.data === "number" ? countRes.data : 0;

    return json({
      requests: reqRes.data ?? [],
      stats: { linked_meetings: linkedMeetings },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = PostSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }

    const { data, error } = await supabase
      .from("meeting_data_import_requests")
      .insert({
        user_id: user.id,
        message: parsed.data.message ?? null,
        source: parsed.data.source,
      })
      .select()
      .single();

    if (error) {
      // 23505 = pending 重複 (UNIQUE 制約)
      if ((error as { code?: string }).code === "23505") {
        return jsonError(
          409,
          "ALREADY_PENDING",
          "既に申請中です。運営からの返答をお待ちください",
        );
      }
      throw error;
    }

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "import_request.create",
      target_type: "import_request",
      target_id: data?.id ?? null,
      payload: { source: parsed.data.source },
      ip: client.ip,
      ua: client.ua,
    });

    return json(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/v1/import-requests?id=xxx
 *
 * pending な自分の申請をキャンセルする (status = cancelled に遷移)。
 * UNIQUE(user_id) WHERE status='pending' partial index が解放されるので再申請可能になる。
 */
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id || !isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }

    const { data, error } = await supabase
      .from("meeting_data_import_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .select()
      .single();
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") {
        return jsonError(
          404,
          "NOT_FOUND",
          "キャンセル可能な pending 申請が見つかりません",
        );
      }
      throw error;
    }

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "import_request.cancel",
      target_type: "import_request",
      target_id: id,
      ip: client.ip,
      ua: client.ua,
    });

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
