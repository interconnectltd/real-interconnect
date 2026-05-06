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
import { NextResponse } from "next/server";

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

    // CDN / 中間 proxy で個人情報を含むレスポンスをキャッシュさせない (admin route 必須)
    const res = json(data);
    res.headers.set("Cache-Control", "no-store, private");
    res.headers.set("Vary", "Cookie");
    return res as unknown as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
