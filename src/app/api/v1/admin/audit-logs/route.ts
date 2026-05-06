/**
 * GET /api/v1/admin/audit-logs
 *
 * 監査ログ検索 (admin only).
 * cursor pagination で 50万行スケール対応.
 */

import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import {
  isValidUUID,
  sanitizeFilterValue,
  isValidIsoTimestamp,
  escapeLikePattern,
} from "@/lib/sanitize";

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
    // ILIKE %_/_ の自動的な全件マッチを防ぐため escape (DoS 防止)
    if (action) q = q.ilike("action", `%${escapeLikePattern(action)}%`);
    if (targetType) q = q.eq("target_type", targetType);
    // target_id は UUID または文字列。空白は trim、不正は無視。
    if (targetId && targetId.trim().length > 0 && targetId.length <= 200) {
      q = q.eq("target_id", targetId.trim());
    }
    // from/to は ISO 8601 のみ許容 (Postgres parse 失敗で 500 が返る経路を遮断)
    if (from && isValidIsoTimestamp(from)) q = q.gte("created_at", from);
    if (to && isValidIsoTimestamp(to)) q = q.lte("created_at", to);

    // cursor は `${created_at}|${id}` 形式で tie-break する。
    // 各成分を strict validate して PostgREST or() 句注入を排除。
    if (cursor) {
      const [cTs, cId] = cursor.split("|");
      if (!cTs || !cId || !isValidIsoTimestamp(cTs) || !isValidUUID(cId)) {
        return jsonError(400, "BAD_REQUEST", "cursor が不正です");
      }
      q = q.or(
        `created_at.lt.${cTs},and(created_at.eq.${cTs},id.lt.${cId})`,
      );
    }

    const { data, error } = await q;
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? `${last.created_at}|${last.id}` : null;

    return json({
      items,
      nextCursor,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
