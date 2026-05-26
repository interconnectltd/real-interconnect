import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data, error } = await supabase
      .from("agencies")
      .select(
        "user_id, status, applied_at, approved_at, suspended_at, total_clicks, total_referrals, total_earnings_jpy, current_balance_jpy, current_rank, commission_rate, payout_method, min_withdrawal_jpy, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("[agency.me] failed:", error.message);
      return jsonError(500, "FETCH_FAILED", "代理店情報の取得に失敗しました");
    }

    let activeReferralCount = 0;
    if (data && (data.status === "approved" || data.status === "suspended")) {
      try {
        const { data: count } = await supabase.rpc("get_active_referral_count", {
          p_agency_user_id: user.id,
        });
        activeReferralCount = typeof count === "number" ? count : 0;
      } catch {
        // RPC 未適用時は 0 で fallback
      }
    }

    return json({
      agency: data ? { ...data, active_referral_count: activeReferralCount } : data,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
