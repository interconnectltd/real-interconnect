import { z } from "zod";
import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { createServiceClient } from "@/lib/supabase/server";

const payoutInfoSchema = z.object({
  payout_method: z.literal("bank_transfer"),
  payout_info: z.object({
    bank_name: z.string().min(1).max(80),
    branch_name: z.string().min(1).max(80),
    account_type: z.string().min(1).max(20),
    account_number: z.string().min(1).max(40),
    account_holder: z.string().min(1).max(80),
  }),
});

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const raw = await request.json().catch(() => ({}));
    const parsed = payoutInfoSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "振込先情報の形式が不正です");
    }

    const { data: agency } = await supabase
      .from("agencies")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!agency || agency.status !== "approved") {
      return jsonError(
        403,
        "NOT_APPROVED_AGENCY",
        "承認された代理店のみ振込先を登録できます",
      );
    }

    const admin = await createServiceClient();
    // TODO: 将来 KMS で暗号化。現状は JSON 文字列をそのまま保存
    const payload = JSON.stringify(parsed.data.payout_info);
    const { error } = await admin
      .from("agencies")
      .update({
        payout_method: parsed.data.payout_method,
        payout_info_encrypted: payload,
      })
      .eq("user_id", user.id);

    if (error) {
      console.warn("[agency.payout-info] update failed:", error.message);
      return jsonError(500, "UPDATE_FAILED", "振込先の保存に失敗しました");
    }

    const { ip, ua } = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "agency.payout_info.update",
      target_type: "agency",
      target_id: user.id,
      payload: { method: parsed.data.payout_method },
      ip,
      ua,
    });

    return json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
