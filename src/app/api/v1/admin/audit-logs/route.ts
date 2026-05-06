/**
 * GET /api/v1/admin/audit-logs
 *
 * 監査ログ検索 (admin only).
 * cursor pagination で 50万行スケール対応.
 */

import {
  withAdminAuth,
  json,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID, sanitizeFilterValue } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await withAdminAuth(request);
    const url = new URL(request.url);

    const actor = url.searchParams.get("actor");
    const action = sanitizeFilterValue(url.searchParams.get("action") ?? "");
    const targetType = sanitizeFilterValue(url.searchParams.get("entity_type") ?? "");
    const targetId = url.searchParams.get("entity_id");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") ?? "50")),
    );

    let q = supabase
      .from("audit_logs")
      .select(
        "id, actor_id, action, target_type, target_id, payload, ip, created_at",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (actor && isValidUUID(actor)) q = q.eq("actor_id", actor);
    if (action) q = q.ilike("action", `%${action}%`);
    if (targetType) q = q.eq("target_type", targetType);
    if (targetId) q = q.eq("target_id", targetId);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    if (cursor) q = q.lt("created_at", cursor);

    const { data, error } = await q;
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1]!.created_at
      : null;

    return json({
      items,
      nextCursor,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
