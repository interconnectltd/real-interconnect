/**
 * GET /api/v1/notifications/count
 *
 * 未読通知件数を返す軽量 endpoint。
 * 旧実装は `/notifications?unread=true` で全行取得→`.length` していたため、
 * 60s 毎に全 payload (本文/メタ含む) を転送して LCP/INP・DB I/O を悪化させていた。
 * count(*) head:true で件数のみ取得し、転送量を 1 整数に圧縮する。
 */

import {
  withAuth,
  json,
  handleApiError,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    if (error) throw error;

    return json({ unread: count ?? 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
