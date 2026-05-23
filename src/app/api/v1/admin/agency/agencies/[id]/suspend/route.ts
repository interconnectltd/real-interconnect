import { z } from "zod";
import { headers } from "next/headers";
import { withAdminAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog } from "@/lib/audit-log";
import { getClientIp } from "@/lib/client-ip";

const suspendBodySchema = z.object({
  action: z.enum(["suspend", "unsuspend"]),
  admin_note: z.string().max(1000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabase, adminSupabase } = await withAdminAuth(request);

    const raw = await request.json().catch(() => ({}));
    const parsed = suspendBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "action を確認してください");
    }
    const { action, admin_note } = parsed.data;

    const { data: ag } = await adminSupabase
      .from("agencies")
      .select("user_id, status")
      .eq("user_id", id)
      .maybeSingle();
    if (!ag) {
      return jsonError(404, "NOT_FOUND", "代理店が見つかりません");
    }

    const now = new Date().toISOString();

    if (action === "suspend") {
      const { error: upErr } = await adminSupabase
        .from("agencies")
        .update({
          status: "suspended",
          suspended_at: now,
          suspended_by: user.id,
        })
        .eq("user_id", id);
      if (upErr) {
        console.warn("[admin.agency.suspend] update failed:", upErr.message);
        return jsonError(500, "UPDATE_FAILED", "停止に失敗しました");
      }
      await adminSupabase
        .from("user_profiles")
        .update({ is_agency: false })
        .eq("id", id);
    } else {
      const { error: upErr } = await adminSupabase
        .from("agencies")
        .update({
          status: "approved",
          suspended_at: null,
          suspended_by: null,
        })
        .eq("user_id", id);
      if (upErr) {
        console.warn("[admin.agency.unsuspend] update failed:", upErr.message);
        return jsonError(500, "UPDATE_FAILED", "再開に失敗しました");
      }
      await adminSupabase
        .from("user_profiles")
        .update({ is_agency: true })
        .eq("id", id);
    }

    const h = await headers();
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: action === "suspend" ? "admin.agency.suspend" : "admin.agency.unsuspend",
      target_type: "agency",
      target_id: id,
      payload: { note: admin_note ? admin_note.slice(0, 200) : null },
      ip: getClientIp(h),
      ua: h.get("user-agent"),
    });

    return json({
      user_id: id,
      status: action === "suspend" ? "suspended" : "approved",
    });
  } catch (e) {
    return handleApiError(e);
  }
}
