import { z } from "zod";
import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

const patchBodySchema = z
  .object({
    label: z.string().max(80).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((b) => b.label !== undefined || b.is_active !== undefined, {
    message: "label または is_active のいずれかを指定してください",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabase } = await withAuth(request);

    const raw = await request.json().catch(() => ({}));
    const parsed = patchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "リクエストが不正です");
    }
    const { label, is_active } = parsed.data;

    const patch: { label?: string | null; is_active?: boolean } = {};
    if (label !== undefined) patch.label = label;
    if (is_active !== undefined) patch.is_active = is_active;

    const { data, error } = await supabase
      .from("referral_links")
      .update(patch)
      .eq("id", id)
      .eq("agency_user_id", user.id)
      .select("id, code, label, is_active, created_at, updated_at")
      .maybeSingle();

    if (error) {
      console.warn("[agency.links.patch] failed:", error.message);
      return jsonError(500, "UPDATE_FAILED", "リンクの更新に失敗しました");
    }
    if (!data) {
      return jsonError(404, "NOT_FOUND", "リンクが見つかりません");
    }

    const { ip, ua } = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "agency.referral_link.update",
      target_type: "referral_link",
      target_id: id,
      payload: {
        label_changed: label !== undefined,
        is_active: is_active ?? null,
      },
      ip,
      ua,
    });

    return json({ link: { ...data, click_count: 0, referral_count: 0 } });
  } catch (e) {
    return handleApiError(e);
  }
}
