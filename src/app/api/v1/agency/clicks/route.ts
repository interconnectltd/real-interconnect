import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const url = new URL(request.url);
    const rawDays = Number(url.searchParams.get("days") ?? "30");
    const days = Number.isFinite(rawDays)
      ? Math.min(Math.max(Math.floor(rawDays), 1), 90)
      : 30;

    const { data: myLinks, error: linksErr } = await supabase
      .from("referral_links")
      .select("id, code, label")
      .eq("agency_user_id", user.id);
    if (linksErr) {
      console.warn("[agency.clicks] links fetch failed:", linksErr.message);
      return jsonError(500, "FETCH_FAILED", "クリック集計に失敗しました");
    }
    const linkIds = (myLinks ?? []).map((l) => l.id);
    if (linkIds.length === 0) {
      return json({ days, by_link: [], daily: emptyDaily(days) });
    }

    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    const { data: clicks, error: clicksErr } = await supabase
      .from("referral_clicks")
      .select("referral_link_id, visitor_id, converted_to_referral_id, clicked_at")
      .in("referral_link_id", linkIds)
      .gte("clicked_at", sinceIso)
      .order("clicked_at", { ascending: false })
      .limit(2000);
    if (clicksErr) {
      console.warn("[agency.clicks] clicks fetch failed:", clicksErr.message);
      return jsonError(500, "FETCH_FAILED", "クリック集計に失敗しました");
    }

    type LinkAgg = {
      link_id: string;
      total: number;
      unique_visitors: Set<string>;
      conversions: number;
    };
    const agg = new Map<string, LinkAgg>();
    for (const id of linkIds) {
      agg.set(id, { link_id: id, total: 0, unique_visitors: new Set(), conversions: 0 });
    }
    const daily = new Map<string, number>();
    for (const c of clicks ?? []) {
      const a = agg.get(c.referral_link_id);
      if (a) {
        a.total += 1;
        a.unique_visitors.add(c.visitor_id);
        if (c.converted_to_referral_id) a.conversions += 1;
      }
      const day = c.clicked_at.slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + 1);
    }

    const dailyList = emptyDaily(days).map((d) => ({
      date: d.date,
      clicks: daily.get(d.date) ?? 0,
    }));

    return json({
      days,
      by_link: Array.from(agg.values()).map((a) => ({
        link_id: a.link_id,
        total: a.total,
        unique_visitors: a.unique_visitors.size,
        conversions: a.conversions,
      })),
      daily: dailyList,
    });
  } catch (e) {
    return handleApiError(e);
  }
}

function emptyDaily(days: number): Array<{ date: string; clicks: number }> {
  const out: Array<{ date: string; clicks: number }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    out.push({ date: d.toISOString().slice(0, 10), clicks: 0 });
  }
  return out;
}
