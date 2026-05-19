import { headers } from "next/headers";
import { z } from "zod";
import { withAdminAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { getClientIp } from "@/lib/client-ip";
import { writeAuditLog } from "@/lib/audit-log";

/**
 * PATCH /api/v1/admin/users/[id]/agency-badge
 *
 * 指定 user の `is_agency` フラグを admin が grant/revoke する endpoint。
 * 操作は audit_logs に `admin.user.grant_agency_badge` / `admin.user.revoke_agency_badge`
 * として記録される。
 *
 * セキュリティ:
 *   - withAdminAuth() で admin 判定。失敗時 403。
 *   - is_agency 列は protect_admin trigger で service_role のみ更新可。
 *     ここでは adminSupabase (service_role) で UPDATE。
 *   - 既存 user 不在/重複/自己付与など、特殊処理は意図的に入れない (admin が
 *     自分自身に付与するのも仕様上許可 — トグルとして使える)。
 */

const bodySchema = z.object({
  grant: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, supabase, adminSupabase } = await withAdminAuth(request);
    const { id } = await params;

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "grant (boolean) を指定してください");
    }
    const { grant } = parsed.data;

    // is_agency は protect_admin trigger で service_role 限定 → adminSupabase 使用
    const { data, error } = await adminSupabase
      .from("user_profiles")
      .update({ is_agency: grant })
      .eq("id", id)
      .select("id, name, is_agency")
      .single();

    if (error || !data) {
      return jsonError(
        500,
        "UPDATE_FAILED",
        "代理店バッジの更新に失敗しました",
      );
    }

    const h = await headers();
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: grant
        ? "admin.user.grant_agency_badge"
        : "admin.user.revoke_agency_badge",
      target_type: "user",
      target_id: id,
      payload: { is_agency: grant, target_name: data.name },
      ip: getClientIp(h),
      ua: h.get("user-agent"),
    });

    return json({ id: data.id, is_agency: data.is_agency });
  } catch (e) {
    return handleApiError(e);
  }
}
