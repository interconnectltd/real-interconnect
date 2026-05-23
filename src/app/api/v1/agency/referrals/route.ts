import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data: myLinks, error: linksErr } = await supabase
      .from("referral_links")
      .select("id, code, label")
      .eq("agency_user_id", user.id);

    if (linksErr) {
      console.warn("[agency.referrals] links fetch failed:", linksErr.message);
      return jsonError(500, "FETCH_FAILED", "リンクの取得に失敗しました");
    }

    const linkIds = (myLinks ?? []).map((l) => l.id);
    if (linkIds.length === 0) {
      return json({ referrals: [] });
    }

    const { data: refs, error: refsErr } = await supabase
      .from("referrals")
      .select(
        "id, referral_link_id, referred_user_id, status, signed_up_at, first_payment_at, churned_at",
      )
      .in("referral_link_id", linkIds)
      .order("signed_up_at", { ascending: false })
      .limit(200);

    if (refsErr) {
      console.warn("[agency.referrals] refs fetch failed:", refsErr.message);
      return jsonError(500, "FETCH_FAILED", "紹介履歴の取得に失敗しました");
    }

    const userIds = Array.from(
      new Set((refs ?? []).map((r) => r.referred_user_id)),
    );
    const { data: users } = await supabase
      .from("user_profiles")
      .select("id, name, email, company, avatar_url")
      .in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);

    const userMap = new Map((users ?? []).map((u) => [u.id, u]));
    const linkMap = new Map((myLinks ?? []).map((l) => [l.id, l]));

    const enriched = (refs ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      signed_up_at: r.signed_up_at,
      first_payment_at: r.first_payment_at,
      churned_at: r.churned_at,
      referral_link: linkMap.get(r.referral_link_id) ?? null,
      referred_user: userMap.get(r.referred_user_id) ?? null,
    }));

    return json({ referrals: enriched });
  } catch (e) {
    return handleApiError(e);
  }
}
