import { z } from "zod";
import { headers } from "next/headers";
import { withAdminAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog } from "@/lib/audit-log";
import { getClientIp } from "@/lib/client-ip";

const reviewBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
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
    const parsed = reviewBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "action と admin_note を確認してください");
    }
    const { action, admin_note } = parsed.data;

    const { data: app, error: fetchErr } = await adminSupabase
      .from("agency_applications")
      .select("id, applicant_id, status")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) {
      console.warn("[admin.agency.applications.patch] fetch failed:", fetchErr.message);
      return jsonError(500, "FETCH_FAILED", "申請の取得に失敗しました");
    }
    if (!app) {
      return jsonError(404, "NOT_FOUND", "申請が見つかりません");
    }
    if (app.status !== "pending") {
      return jsonError(409, "NOT_PENDING", "保留中ではない申請は処理できません");
    }

    const now = new Date().toISOString();
    const newStatus = action === "approve" ? "approved" : "rejected";

    const { error: updateErr } = await adminSupabase
      .from("agency_applications")
      .update({
        status: newStatus,
        admin_note: admin_note ?? null,
        reviewed_by: user.id,
        reviewed_at: now,
      })
      .eq("id", id);
    if (updateErr) {
      console.warn("[admin.agency.applications.patch] update failed:", updateErr.message);
      return jsonError(500, "UPDATE_FAILED", "申請の更新に失敗しました");
    }

    if (action === "approve") {
      const { error: upsertErr } = await adminSupabase
        .from("agencies")
        .upsert(
          {
            user_id: app.applicant_id,
            status: "approved",
            approved_at: now,
            approved_by: user.id,
          },
          { onConflict: "user_id" },
        );
      if (upsertErr) {
        console.warn("[admin.agency.applications.patch] agencies upsert failed:", upsertErr.message);
      }

      // is_agency=true は protect_admin trigger により service_role 必須
      const { error: profileErr } = await adminSupabase
        .from("user_profiles")
        .update({ is_agency: true })
        .eq("id", app.applicant_id);
      if (profileErr) {
        console.warn("[admin.agency.applications.patch] is_agency=true failed:", profileErr.message);
      }
    } else {
      await adminSupabase
        .from("agencies")
        .upsert(
          { user_id: app.applicant_id, status: "rejected" },
          { onConflict: "user_id" },
        );
    }

    const h = await headers();
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: action === "approve" ? "admin.agency.approve" : "admin.agency.reject",
      target_type: "agency_application",
      target_id: id,
      payload: {
        applicant_id: app.applicant_id,
        note: admin_note ? admin_note.slice(0, 200) : null,
      },
      ip: getClientIp(h),
      ua: h.get("user-agent"),
    });

    return json({ id, status: newStatus });
  } catch (e) {
    return handleApiError(e);
  }
}
