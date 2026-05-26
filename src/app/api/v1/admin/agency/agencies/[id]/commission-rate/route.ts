import { z } from "zod";
import { headers } from "next/headers";
import { withAdminAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog } from "@/lib/audit-log";
import { getClientIp } from "@/lib/client-ip";

const commissionRateBodySchema = z.object({
  rate: z.number().min(0.01).max(1.0),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, adminSupabase } = await withAdminAuth(request);

    const raw = await request.json().catch(() => ({}));
    const parsed = commissionRateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "rate は 0.01〜1.0 の範囲で指定してください");
    }
    const { rate } = parsed.data;

    const { data: ag } = await adminSupabase
      .from("agencies")
      .select("user_id, status, commission_rate")
      .eq("user_id", id)
      .maybeSingle();
    if (!ag) {
      return jsonError(404, "NOT_FOUND", "代理店が見つかりません");
    }

    const previousRate = ag.commission_rate;

    const { error: upErr } = await adminSupabase
      .from("agencies")
      .update({ commission_rate: rate })
      .eq("user_id", id);
    if (upErr) {
      console.warn("[admin.agency.update_commission_rate] update failed:", upErr.message);
      return jsonError(500, "UPDATE_FAILED", "手数料率の更新に失敗しました");
    }

    const h = await headers();
    void writeAuditLog(adminSupabase, {
      actor_id: user.id,
      action: "admin.agency.update_commission_rate",
      target_type: "agency",
      target_id: id,
      payload: { previous_rate: previousRate, new_rate: rate },
      ip: getClientIp(h),
      ua: h.get("user-agent"),
    });

    return json({ user_id: id, commission_rate: rate });
  } catch (e) {
    return handleApiError(e);
  }
}
