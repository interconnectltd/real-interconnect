import { z } from "zod";
import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { generateReferralCode } from "@/lib/agency";

const createBodySchema = z.object({
  label: z.string().max(80).optional(),
});

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data: links, error } = await supabase
      .from("referral_links")
      .select("id, code, label, is_active, created_at, updated_at")
      .eq("agency_user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[agency.links.get] failed:", error.message);
      return jsonError(500, "FETCH_FAILED", "リンクの取得に失敗しました");
    }

    const enriched = await Promise.all(
      (links ?? []).map(async (l) => {
        const [clicksRes, refsRes] = await Promise.all([
          supabase
            .from("referral_clicks")
            .select("*", { count: "exact", head: true })
            .eq("referral_link_id", l.id),
          supabase
            .from("referrals")
            .select("*", { count: "exact", head: true })
            .eq("referral_link_id", l.id),
        ]);
        return {
          ...l,
          click_count: clicksRes.count ?? 0,
          referral_count: refsRes.count ?? 0,
        };
      }),
    );

    return json({ links: enriched });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const raw = await request.json().catch(() => ({}));
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", "label は 80 字以内で指定してください");
    }
    const { label } = parsed.data;

    // 承認済み代理店のみ発行可
    const { data: agency } = await supabase
      .from("agencies")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!agency || agency.status !== "approved") {
      return jsonError(
        403,
        "NOT_APPROVED_AGENCY",
        "承認された代理店のみリンクを発行できます",
      );
    }

    // code 衝突時は最大 3 回までリトライ
    let inserted: {
      id: string;
      code: string;
      label: string | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    } | null = null;
    let lastError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const code = generateReferralCode();
      const { data, error } = await supabase
        .from("referral_links")
        .insert({
          agency_user_id: user.id,
          code,
          label: label ?? null,
        })
        .select("id, code, label, is_active, created_at, updated_at")
        .single();
      if (!error) {
        inserted = data;
        break;
      }
      lastError = { code: error.code, message: error.message };
      if (error.code !== "23505") break;
    }

    if (!inserted) {
      console.warn("[agency.links.post] insert failed:", lastError);
      return jsonError(500, "INSERT_FAILED", "リンクの発行に失敗しました");
    }

    const { ip, ua } = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "agency.referral_link.create",
      target_type: "referral_link",
      target_id: inserted.id,
      payload: { code: inserted.code },
      ip,
      ua,
    });

    return json(
      { link: { ...inserted, click_count: 0, referral_count: 0 } },
      201,
    );
  } catch (e) {
    return handleApiError(e);
  }
}
