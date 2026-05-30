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
        "id, name, email, company, position, industry, is_admin, is_active, is_agency, manual_plan, onboarding_step, created_at",
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

    // 各 user の最新 subscription を一括取得して merge (N+1 回避)。
    // idx_subscriptions_user (user_id, created_at DESC) を使うので fast。
    const userIds = (data ?? []).map((u) => u.id);
    const subsMap = new Map<
      string,
      { status: string | null; current_period_end: string | null }
    >();
    if (userIds.length > 0) {
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("user_id, status, current_period_end, created_at")
        .in("user_id", userIds)
        .order("created_at", { ascending: false });
      // 同一 user_id の最初の行 (= 最新) のみ採用
      for (const s of subs ?? []) {
        if (!subsMap.has(s.user_id)) {
          subsMap.set(s.user_id, {
            status: s.status ?? null,
            current_period_end: s.current_period_end ?? null,
          });
        }
      }
    }
    const usersWithSub = (data ?? []).map((u) => ({
      ...u,
      subscription_status: subsMap.get(u.id)?.status ?? null,
      current_period_end: subsMap.get(u.id)?.current_period_end ?? null,
    }));

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
      users: usersWithSub,
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
