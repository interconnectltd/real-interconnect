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

const PostSchema = z.object({
  message: z.string().trim().max(1000).optional().nullable(),
  source: z.enum(["tldv", "manual_csv", "other"]).default("tldv"),
});

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const [reqRes, linkedCountRes] = await Promise.all([
      supabase
        .from("meeting_data_import_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .abortSignal(request.signal),
      // 自分に紐付けられた meeting_participants の件数 (=取込済 transcript の概算)
      supabase
        .from("meeting_participants")
        .select("transcript_id", { count: "exact", head: false })
        .eq("user_id", user.id),
    ]);
    if (reqRes.error) throw reqRes.error;
    if (linkedCountRes.error) throw linkedCountRes.error;

    type LinkedRow = { transcript_id: string | null };
    const distinctTranscripts = new Set(
      ((linkedCountRes.data as LinkedRow[] | null) ?? [])
        .map((r) => r.transcript_id)
        .filter((v): v is string => v !== null),
    ).size;

    return json({
      requests: reqRes.data ?? [],
      stats: {
        linked_meetings: distinctTranscripts,
      },
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
      action: "chat.message.send", // 既存 enum 制約内で代用 (audit_logs 改修は後)
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
