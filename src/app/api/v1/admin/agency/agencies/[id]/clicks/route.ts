import { withAdminAuth, json, handleApiError, checkDbRateLimit } from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { parseUserAgent } from "@/lib/ua-parse";
import { sanitizeReferrer } from "@/lib/referrer-sanitize";
import { ApiError } from "@/lib/errors";
import { isValidUUID } from "@/lib/sanitize";
import type { Database } from "@/types/database";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: agencyUserId } = await params;
    if (!isValidUUID(agencyUserId)) {
      throw new ApiError(400, "BAD_REQUEST", "id (UUID) 必須");
    }
    const { user, adminSupabase, reason } = await withAdminAuth(request, {
      requireReason: true,
    });

    const body = await request.json();
    const adminPassword = body.password;
    if (!adminPassword || typeof adminPassword !== "string" || adminPassword.length < 1) {
      throw new ApiError(400, "PASSWORD_REQUIRED", "パスワードの入力が必要です");
    }

    const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
    const tempClient = createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error: authError } = await tempClient.auth.signInWithPassword({
      email: user.email!,
      password: adminPassword,
    });
    if (authError) {
      throw new ApiError(401, "INVALID_PASSWORD", "パスワードが正しくありません");
    }

    const allowed = await checkDbRateLimit(
      adminSupabase,
      user.id,
      "admin_pii_clicks",
      10,
      3600,
      true,
    );
    if (!allowed) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "アクセス上限に達しました。1時間後に再試行してください",
      );
    }

    const { data: links } = await adminSupabase
      .from("referral_links")
      .select("id")
      .eq("agency_user_id", agencyUserId);

    if (!links || links.length === 0) {
      return json({ clicks: [] });
    }

    const linkIds = links.map((l) => l.id);
    const { data: clicks, error } = await adminSupabase
      .from("referral_clicks")
      .select(
        "id, referral_link_id, visitor_id, ip_hash, user_agent, referrer, converted_to_referral_id, clicked_at",
      )
      .in("referral_link_id", linkIds)
      .order("clicked_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const result = (clicks ?? []).map((c) => {
      const parsed = parseUserAgent(c.user_agent);
      const uaParsed =
        parsed.browser && parsed.os
          ? `${parsed.browser} · ${parsed.os}${parsed.device ? ` · ${parsed.device}` : ""}`
          : c.user_agent ?? "—";
      return {
        id: c.id,
        clicked_at: c.clicked_at,
        ip_hash: c.ip_hash,
        user_agent_raw: c.user_agent,
        user_agent_parsed: uaParsed,
        referrer_raw: c.referrer,
        referrer_display: sanitizeReferrer(c.referrer),
        visitor_id: c.visitor_id,
        converted: !!c.converted_to_referral_id,
      };
    });

    const { ip, ua } = extractClientInfo(request);
    void writeAuditLog(adminSupabase, {
      actor_id: user.id,
      action: "admin.agency.view_clicks",
      target_type: "agencies",
      target_id: agencyUserId,
      payload: { reason, result_count: result.length },
      ip,
      ua,
    });

    return json({ clicks: result });
  } catch (error) {
    return handleApiError(error);
  }
}
