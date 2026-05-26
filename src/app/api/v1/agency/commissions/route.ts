import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));

    if (!year || !month || month < 1 || month > 12) {
      return jsonError(400, "BAD_REQUEST", "year と month (1-12) は必須です");
    }

    const from = new Date(year, month - 1, 1).toISOString();
    const to = new Date(year, month, 1).toISOString();

    const { data: links } = await supabase
      .from("referral_links")
      .select("id")
      .eq("agency_user_id", user.id);

    const linkIds = (links ?? []).map((l) => l.id);

    if (linkIds.length === 0) {
      return json({ commissions: [], summary: { total_amount: 0, count: 0, period: `${year}-${String(month).padStart(2, "0")}` } });
    }

    const { data: referrals } = await supabase
      .from("referrals")
      .select("id, referred_user_id")
      .in("referral_link_id", linkIds);

    const referralIds = (referrals ?? []).map((r) => r.id);
    if (referralIds.length === 0) {
      return json({ commissions: [], summary: { total_amount: 0, count: 0, period: `${year}-${String(month).padStart(2, "0")}` } });
    }

    const { data: commissions, error } = await supabase
      .from("commissions")
      .select("id, referral_id, amount_jpy, rate, basis_jpy, status, created_at, confirmed_at")
      .in("referral_id", referralIds)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true });

    if (error) {
      return jsonError(500, "FETCH_FAILED", "コミッションの取得に失敗しました");
    }

    const userIds = (referrals ?? []).map((r) => r.referred_user_id);
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, name, company")
      .in("id", userIds);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const referralUserMap = new Map((referrals ?? []).map((r) => [r.id, r.referred_user_id]));

    const enriched = (commissions ?? []).map((c) => {
      const userId = referralUserMap.get(c.referral_id);
      const profile = userId ? profileMap.get(userId) : null;
      return {
        ...c,
        referred_user: profile ? { name: profile.name, company: profile.company } : null,
      };
    });

    const totalAmount = enriched.reduce((sum, c) => sum + (c.amount_jpy ?? 0), 0);

    return json({
      commissions: enriched,
      summary: {
        total_amount: totalAmount,
        count: enriched.length,
        period: `${year}-${String(month).padStart(2, "0")}`,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
