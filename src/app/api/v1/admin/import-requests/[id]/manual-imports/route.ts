/**
 * POST /api/v1/admin/import-requests/[id]/manual-imports
 *   対面会議や tl;dv 録画なしのケースで、admin が文字起こし/要約を直接貼り付け
 *   することで取り込む。
 *
 *   body:
 *     - title?            string   (会議タイトル)
 *     - meeting_date?     YYYY-MM-DD
 *     - participant_names? string[]
 *     - manual_transcript string (1-200000 文字)
 *     - manual_summary?   string (任意)
 */

import { z } from "zod";
import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const PostSchema = z.object({
  title: z.string().max(200).optional(),
  meeting_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  participant_names: z.array(z.string().min(1).max(100)).max(50).optional(),
  manual_transcript: z.string().min(1).max(200000),
  manual_summary: z.string().max(50000).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }
    const { user, supabase } = await withAdminAuth(request);

    const raw: unknown = await request.json().catch(() => null);
    const parsed = PostSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }

    // 申請取得 (user_id を引く)
    const { data: req, error: reqErr } = await supabase
      .from("meeting_data_import_requests")
      .select("id, user_id, status")
      .eq("id", id)
      .maybeSingle();
    if (reqErr) {
      return jsonError(500, "DB_ERROR", reqErr.message ?? "request fetch failed");
    }
    if (!req) return jsonError(404, "NOT_FOUND", "申請が見つかりません");

    // INSERT (database.ts 未生成のテーブルのため LooseInsert で型回避)
    type LooseInsert = {
      from: (table: string) => {
        insert: (rows: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
    const { data: row, error: insErr } = await (
      supabase as unknown as LooseInsert
    )
      .from("meeting_manual_imports")
      .insert({
        request_id: id,
        user_id: req.user_id,
        title: parsed.data.title ?? null,
        meeting_date: parsed.data.meeting_date ?? null,
        participant_names: parsed.data.participant_names ?? null,
        manual_transcript: parsed.data.manual_transcript,
        manual_summary: parsed.data.manual_summary ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (insErr) {
      return jsonError(500, "DB_ERROR", insErr.message ?? "insert failed");
    }

    // 申請を pending → processing に進める (済みなら何もしない)
    if (req.status === "pending") {
      await supabase
        .from("meeting_data_import_requests")
        .update({ status: "processing" })
        .eq("id", id);
    }

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.import_request.update",
      target_type: "import_request",
      target_id: id,
      payload: {
        op: "manual_import",
        manual_import_id: row?.id ?? null,
        target_user_id: req.user_id,
        transcript_chars: parsed.data.manual_transcript.length,
        summary_chars: parsed.data.manual_summary?.length ?? 0,
        participant_count: parsed.data.participant_names?.length ?? 0,
      },
      ip: client.ip,
      ua: client.ua,
    });

    return json({ id: row?.id ?? null }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
