/**
 * GET /api/v1/admin/audit-chain/verify
 *   audit_logs の SHA-256 hash chain を検証 (00048 migration)。
 *
 *   レスポンス:
 *     - { ok: true, total_rows, message } 整合性 OK
 *     - { ok: false, total_rows, first_broken_seq, first_broken_id, message }
 *       不整合があれば最早の壊れ位置を返す
 *
 * RPC (verify_audit_chain) は SECURITY DEFINER + admin only check 内蔵。
 * 監査ログの WORM 強化を実運用に乗せるための admin diagnose endpoint。
 */

import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface VerifyRow {
  total_rows: number;
  first_broken_seq: number | null;
  first_broken_id: string | null;
  message: string;
}

export async function GET(request: Request) {
  try {
    const { supabase } = await withAdminAuth(request);

    type RpcLoose = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: VerifyRow[] | null;
        error: { message?: string } | null;
      }>;
    };
    const { data, error } = await (
      supabase as unknown as RpcLoose
    ).rpc("verify_audit_chain", {});
    if (error) {
      return jsonError(500, "DB_ERROR", error.message ?? "verify failed");
    }
    const row = data?.[0];
    if (!row) {
      return json({ ok: true, total_rows: 0, message: "empty chain" });
    }
    return json({
      ok: row.first_broken_seq === null,
      total_rows: row.total_rows,
      first_broken_seq: row.first_broken_seq,
      first_broken_id: row.first_broken_id,
      message: row.message,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
