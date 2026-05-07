/**
 * src/lib/audit-log.ts
 *
 * audit_logs テーブルへの append-only ログ書き込み helper。
 * 5 観点並列レビュー (Sec 71/100) で「監査ログ全欠落」を指摘されたため新設。
 *
 * - service_role client 経由で INSERT (RLS bypass)
 * - 失敗してもメイン処理は止めない (best-effort)
 * - PII 漏洩防止のため payload は最小構造化情報のみ
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export type AuditAction =
  // chat 系
  | "chat.message.send"
  | "chat.message.read"
  | "chat.room.create"
  | "chat.message.delete"
  | "chat.message.edit"
  // calendar
  | "calendar.connect"
  | "calendar.disconnect"
  | "calendar.event.create"
  // 取込申請 (一般ユーザー操作)
  | "import_request.create"
  | "import_request.cancel"
  // admin 操作 (法務 R5 / 個情法 27 条対応の追跡用)
  | "admin.view_user"
  | "admin.user_list.view"
  | "admin.contact.list_view"
  | "admin.contact.update"
  | "admin.import_request.list_view"
  | "admin.import_request.update"
  | "admin.user.suspend"
  | "admin.user.unsuspend"
  | "admin.user.delete"
  | "admin.role.grant"
  | "admin.role.revoke";

export type AuditLogParams = {
  actor_id: string;
  action: AuditAction;
  target_type?: string | null;
  target_id?: string | null;
  payload?: Record<string, unknown> | null;
  ip?: string | null;
  ua?: string | null;
};

/**
 * audit_logs に1行追加 (best-effort)。
 * @returns 成功なら true、失敗なら false (例外は throw しない)
 */
export async function writeAuditLog(
  supabase: SupabaseClient<Database>,
  params: AuditLogParams,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: params.actor_id,
      action: params.action,
      target_type: params.target_type ?? null,
      target_id: params.target_id ?? null,
      payload: (params.payload as Json | undefined) ?? null,
      ip: params.ip ?? null,
      ua: params.ua ?? null,
    });

    if (error) {
      console.warn("[audit-log] insert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[audit-log] exception:", err);
    return false;
  }
}

/**
 * Request の Headers から IP / UA を抽出 (Netlify / Vercel 互換)。
 */
export function extractClientInfo(request: Request): {
  ip: string | null;
  ua: string | null;
} {
  // Wave1 sec audit: getClientIp と同等の優先順位 (Netlify edge ヘッダ優先)
  const headers = request.headers;
  const ip =
    headers.get("x-nf-client-connection-ip") ??
    headers.get("cf-connecting-ip") ??
    headers.get("true-client-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    null;
  const ua = headers.get("user-agent") ?? null;
  return { ip, ua };
}
