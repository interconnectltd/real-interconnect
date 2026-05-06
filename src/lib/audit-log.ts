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
  // 将来拡張
  | "chat.message.delete"
  | "chat.message.edit"
  | "calendar.connect"
  | "calendar.disconnect"
  | "calendar.event.create";

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
  const headers = request.headers;
  const ip =
    headers.get("x-nf-client-connection-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null;
  const ua = headers.get("user-agent") ?? null;
  return { ip, ua };
}
