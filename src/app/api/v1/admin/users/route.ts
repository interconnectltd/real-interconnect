/**
 * GET /api/v1/admin/users
 *
 * ユーザー一覧 (admin only)。検索 + フィルタ + ページネーション。
 * クエリ: ?q=name OR company / ?industry= / ?is_active= / ?page= / ?pageSize=
 */

import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { sanitizeFilterValue, escapeLikePattern } from "@/lib/sanitize";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const ALLOWED_ORDER = new Set(["created_at", "last_login_at", "name"]);

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAdminAuth(request);
    const url = new URL(request.url);

    const q = sanitizeFilterValue(url.searchParams.get("q") ?? "");
    const industry = sanitizeFilterValue(url.searchParams.get("industry") ?? "");
    const isActiveParam = url.searchParams.get("is_active");
    const incomplete = url.searchParams.get("incomplete") === "1";
    const isAdminParam = url.searchParams.get("is_admin");
    const orderByRaw = url.searchParams.get("order") ?? "created_at";
    const orderBy = ALLOWED_ORDER.has(orderByRaw) ? orderByRaw : "created_at";

    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? "50")),
    );
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from("user_profiles")
      // count: estimated で 50k+ rows でも seq scan を回避 (HubSpot/Salesforce 標準)
      .select(
        "id, name, email, company, position, industry, is_admin, is_active, onboarding_step, created_at",
        { count: "estimated" },
      );

    if (q) {
      // ILIKE %q% を name / company / email で OR (% _ \\ をエスケープ済)
      const pattern = `%${escapeLikePattern(q)}%`;
      query = query.or(
        `name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`,
      );
    }
    if (industry) query = query.eq("industry", industry);
    if (isActiveParam === "true") query = query.eq("is_active", true);
    if (isActiveParam === "false") query = query.eq("is_active", false);
    if (isAdminParam === "true") query = query.eq("is_admin", true);
    if (isAdminParam === "false") query = query.eq("is_admin", false);
    if (incomplete) {
      query = query
        .eq("is_active", true)
        .or("industry.is.null,bio.is.null");
    }

    query = query
      .order(orderBy as "created_at" | "name", { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;
    if (error) {
      return jsonError(500, "DB_ERROR", error.message);
    }

    // Bulk PII access の証跡 (Wave5 sec audit / 個情法 R5)。
    // best-effort で fire-and-forget。失敗時はサービス継続。
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.user_list.view",
      target_type: "user_profiles",
      target_id: null,
      payload: {
        q: q || null,
        industry: industry || null,
        is_active: isActiveParam,
        is_admin: isAdminParam,
        page,
        pageSize,
        result_count: data?.length ?? 0,
      },
      ip: client.ip,
      ua: client.ua,
    });

    const res = json({
      users: data ?? [],
      meta: {
        page,
        pageSize,
        totalCount: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      },
    });
    res.headers.set("Cache-Control", "no-store, private");
    res.headers.set("Vary", "Cookie");
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
