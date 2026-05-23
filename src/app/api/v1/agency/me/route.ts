import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data, error } = await supabase
      .from("agencies")
      .select(
        "user_id, status, applied_at, approved_at, suspended_at, total_clicks, total_referrals, total_earnings_jpy, current_balance_jpy, current_rank, payout_method, min_withdrawal_jpy, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("[agency.me] failed:", error.message);
      return jsonError(500, "FETCH_FAILED", "代理店情報の取得に失敗しました");
    }

    return json({ agency: data });
  } catch (e) {
    return handleApiError(e);
  }
}
