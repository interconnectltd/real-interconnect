import { withAuth, jsonError, handleApiError } from "@/lib/api-helpers";
import { renderToBuffer } from "@react-pdf/renderer";
import { StatementTemplate, type CommissionItem, type StatementData } from "./template";
import { RANK_LABEL } from "@/lib/agency";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));

    if (!year || !month || month < 1 || month > 12) {
      return jsonError(400, "BAD_REQUEST", "year と month (1-12) は必須です");
    }

    const { data: agency } = await supabase
      .from("agencies")
      .select("commission_rate, current_rank")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agency) {
      return jsonError(403, "NOT_AGENCY", "代理店として承認されていません");
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("name, company")
      .eq("id", user.id)
      .maybeSingle();

    const from = new Date(year, month - 1, 1).toISOString();
    const to = new Date(year, month, 1).toISOString();

    const { data: links } = await supabase
      .from("referral_links")
      .select("id")
      .eq("agency_user_id", user.id);

    const linkIds = (links ?? []).map((l) => l.id);
    let commissions: CommissionItem[] = [];
    let totalAmount = 0;

    if (linkIds.length > 0) {
      const { data: referrals } = await supabase
        .from("referrals")
        .select("id, referred_user_id")
        .in("referral_link_id", linkIds);

      const referralIds = (referrals ?? []).map((r) => r.id);

      if (referralIds.length > 0) {
        const { data: rawCommissions } = await supabase
          .from("commissions")
          .select("id, referral_id, amount_jpy, rate, basis_jpy, status, created_at")
          .in("referral_id", referralIds)
          .gte("created_at", from)
          .lt("created_at", to)
          .order("created_at", { ascending: true });

        const userIds = (referrals ?? []).map((r) => r.referred_user_id);
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("id, name, company")
          .in("id", userIds);

        const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
        const referralUserMap = new Map((referrals ?? []).map((r) => [r.id, r.referred_user_id]));

        commissions = (rawCommissions ?? []).map((c) => {
          const uid = referralUserMap.get(c.referral_id);
          const p = uid ? profileMap.get(uid) : null;
          return { ...c, referred_user: p ? { name: p.name, company: p.company } : null };
        });

        totalAmount = commissions.reduce((sum, c) => sum + (c.amount_jpy ?? 0), 0);
      }
    }

    const statementData: StatementData = {
      period: `${year}-${String(month).padStart(2, "0")}`,
      year,
      month,
      agencyName: profile?.name ?? "—",
      agencyCompany: profile?.company ?? null,
      commissionRate: agency.commission_rate ?? 0.2,
      rank: RANK_LABEL[agency.current_rank as keyof typeof RANK_LABEL] ?? agency.current_rank,
      commissions,
      totalAmount,
      generatedAt: new Date().toLocaleDateString("ja-JP"),
    };

    const buffer = await renderToBuffer(
      StatementTemplate({ data: statementData }),
    );

    const filename = `interconnect_statement_${year}_${String(month).padStart(2, "0")}.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
