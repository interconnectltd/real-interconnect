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
import { sanitizeFilterValue } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

const ALLOWED_ORDER = new Set(["created_at", "last_login_at", "name"]);

export async function GET(request: Request) {
  try {
    const { supabase } = await withAdminAuth(request);
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
      .select(
        "id, name, email, company, position, industry, is_admin, is_active, onboarding_step, created_at",
        { count: "exact" },
      );

    if (q) {
      // ILIKE %q% を name / company / email で OR
      const pattern = `%${q}%`;
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

    return json({
      users: data ?? [],
      meta: {
        page,
        pageSize,
        totalCount: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
