/**
 * GET   /api/v1/admin/import-requests          - 全申請一覧 (admin only)
 * PATCH /api/v1/admin/import-requests?id=...   - 状態変更 (admin only)
 *
 * admin = user_profiles.is_admin = true
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

const PatchSchema = z.object({
  status: z.enum(["pending", "processing", "done", "rejected"]),
  admin_note: z.string().max(2000).optional().nullable(),
});

async function ensureAdmin(supabase: import("@supabase/supabase-js").SupabaseClient<import("@/types/database").Database>, userId: string) {
  const { data } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(data?.is_admin);
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    if (!(await ensureAdmin(supabase, user.id))) {
      return jsonError(403, "FORBIDDEN", "admin 権限が必要です");
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    let q = supabase
      .from("meeting_data_import_requests")
      .select("*, user_profiles!meeting_data_import_requests_user_id_fkey(id, name, email, company)")
      .order("created_at", { ascending: false })
      .abortSignal(request.signal);
    if (status) {
      q = q.eq("status", status as "pending" | "processing" | "done" | "rejected" | "cancelled");
    }

    const { data, error } = await q;
    if (error) throw error;
    return json(data ?? []);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    if (!(await ensureAdmin(supabase, user.id))) {
      return jsonError(403, "FORBIDDEN", "admin 権限が必要です");
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id || !isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }

    const update = {
      status: parsed.data.status,
      admin_note: parsed.data.admin_note ?? null,
      processed_at:
        parsed.data.status === "done" || parsed.data.status === "rejected"
          ? new Date().toISOString()
          : null,
      processed_by:
        parsed.data.status === "done" || parsed.data.status === "rejected"
          ? user.id
          : null,
    };

    const { data, error } = await supabase
      .from("meeting_data_import_requests")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "chat.message.send",
      target_type: "import_request",
      target_id: id,
      payload: { status: parsed.data.status },
      ip: client.ip,
      ua: client.ua,
    });

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
