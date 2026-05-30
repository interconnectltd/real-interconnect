import { headers } from "next/headers";
import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { getClientIp } from "@/lib/client-ip";
import { writeAuditLog } from "@/lib/audit-log";
import { sendMonitorDowngradeEmail } from "@/lib/email/send-monitor-downgrade";

/**
 * PATCH /api/v1/admin/users/[id]/downgrade-plan
 *
 * モニター会員 → 無料会員 へのダウングレード専用 endpoint。
 *
 * 仕様:
 *   - 現在の manual_plan が 'monitor' のユーザーのみ対象 (それ以外は 400)
 *   - DB: user_profiles.manual_plan = 'free' に UPDATE
 *   - 本人にダウングレード通知メールを送信 (best-effort)
 *   - 監査ログに admin.user.downgrade_plan_monitor_to_free を記録
 *
 * 安全策:
 *   - 'free' / 'paid' の人を間違えてダウングレードしないよう、必ず monitor チェック
 *   - メール送信失敗は DB 更新を rollback しない (best-effort)
 *   - Stripe paid のユーザーには絶対影響なし (manual_plan = null のため対象外)
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, supabase, adminSupabase } = await withAdminAuth(request);
    const { id } = await params;

    // 現状確認: manual_plan = 'monitor' でなければ拒否
    const { data: current, error: currentErr } = await adminSupabase
      .from("user_profiles")
      .select("id, name, email, manual_plan")
      .eq("id", id)
      .maybeSingle();
    if (currentErr) {
      return jsonError(500, "FETCH_FAILED", "ユーザー情報の取得に失敗しました");
    }
    if (!current) {
      return jsonError(404, "NOT_FOUND", "ユーザーが見つかりません");
    }
    if (current.manual_plan !== "monitor") {
      return jsonError(
        400,
        "NOT_MONITOR",
        "モニター会員のみダウングレード可能です (現在のプラン: " +
          (current.manual_plan ?? "Stripe基準") +
          ")",
      );
    }

    // DB 更新: manual_plan = 'free'
    const { data: updated, error: updateErr } = await adminSupabase
      .from("user_profiles")
      .update({ manual_plan: "free" })
      .eq("id", id)
      .select("id, name, email, manual_plan")
      .single();

    if (updateErr || !updated) {
      return jsonError(500, "UPDATE_FAILED", "プランの更新に失敗しました");
    }

    // 監査ログ
    const h = await headers();
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.user.downgrade_plan_monitor_to_free",
      target_type: "user",
      target_id: id,
      payload: {
        from_plan: "monitor",
        to_plan: "free",
        target_name: updated.name,
        target_email: updated.email,
      },
      ip: getClientIp(h),
      ua: h.get("user-agent"),
    });

    // メール送信 (best-effort)。失敗しても DB 更新は維持。
    let emailStatus: "sent" | "fallback" | "failed" = "failed";
    try {
      const result = await sendMonitorDowngradeEmail({
        email: updated.email,
        name: updated.name,
      });
      emailStatus = result.sent ? "sent" : result.fallback ? "fallback" : "failed";
    } catch (e) {
      console.error("[downgrade-plan] email send threw:", e);
    }

    return json({
      id: updated.id,
      manual_plan: updated.manual_plan,
      email_status: emailStatus,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
