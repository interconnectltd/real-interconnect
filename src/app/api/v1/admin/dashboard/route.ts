/**
 * GET /api/v1/admin/dashboard
 *
 * 運営ダッシュボード KPI 集計を `admin_dashboard_kpi()` RPC で 1 発取得。
 * 旧実装は audit_logs 全件転送 → JS Set で distinct していたため本番 OOM 必至。
 * 全カウントを SQL 側で完結させる。
 */

import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await withAdminAuth(request);

    type RpcLoose = {
      rpc: (
        fn: string,
        args?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const { data, error } = await (supabase as unknown as RpcLoose).rpc(
      "admin_dashboard_kpi",
    );
    if (error) {
      return jsonError(500, "DB_ERROR", error.message ?? "RPC failed");
    }

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
