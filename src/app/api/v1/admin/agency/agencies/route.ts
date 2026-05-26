import { withAdminAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

const VALID_STATUSES = new Set(["approved", "suspended", "all"]);

export async function GET(request: Request) {
  try {
    const { adminSupabase } = await withAdminAuth(request);

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "approved";

    if (!VALID_STATUSES.has(status)) {
      return jsonError(400, "BAD_REQUEST", "status は approved, suspended, all のいずれかを指定してください");
    }

    let query = adminSupabase
      .from("agencies")
      .select(
        "user_id, status, commission_rate, current_rank, total_referrals, total_clicks, total_earnings_jpy, current_balance_jpy, approved_at, created_at, user_profiles(name, email, company, avatar_url)",
      )
      .order("approved_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", status as "approved" | "suspended");
    }

    const { data, error } = await query;
    if (error) {
      console.warn("[admin.agency.list] query failed:", error.message);
      return jsonError(500, "QUERY_FAILED", "代理店一覧の取得に失敗しました");
    }

    const agencies = (data ?? []).map((row) => ({
      ...row,
      profile: Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles,
      user_profiles: undefined,
    }));

    return json({ agencies });
  } catch (e) {
    return handleApiError(e);
  }
}
