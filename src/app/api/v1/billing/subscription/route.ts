import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, trial_end, last_invoice_amount_jpy",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[billing.subscription] failed:", error.message);
      return jsonError(500, "FETCH_FAILED", "サブスクリプション情報の取得に失敗しました");
    }

    return json({ subscription: data });
  } catch (e) {
    return handleApiError(e);
  }
}
