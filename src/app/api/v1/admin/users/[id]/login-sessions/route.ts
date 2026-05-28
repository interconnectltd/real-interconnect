import { withAdminAuth, json, handleApiError, checkDbRateLimit } from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { isValidUUID } from "@/lib/sanitize";
import { ApiError } from "@/lib/errors";
import type { Database } from "@/types/database";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
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
      "admin_pii_login_sessions",
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

    const { data: sessions, error } = await adminSupabase
      .from("login_sessions")
      .select("id, ip_address, user_agent, device, browser, os, referrer, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const { ip, ua } = extractClientInfo(request);
    void writeAuditLog(adminSupabase, {
      actor_id: user.id,
      action: "admin.view_login_sessions",
      target_type: "user",
      target_id: id,
      payload: { reason, result_count: (sessions ?? []).length },
      ip,
      ua,
    });

    return json({ login_sessions: sessions ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}
