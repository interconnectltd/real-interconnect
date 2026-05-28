/**
 * GET /api/v1/admin/users/[id]?reason=...
 *
 * ユーザー詳細 (admin only / 個人情報閲覧のため reason 必須 5-500 字)。
 * 同時に audit_logs に view_user 記録を残す (best-effort)。
 */

import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

interface AuditLogRow {
  id: string | number;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Json;
  created_at: string;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }

    const { user, supabase, reason } = await withAdminAuth(request, {
      requireReason: true,
    });

    // profile (基本情報)
    const { data: profile, error: profileErr } = await supabase
      .from("user_profiles")
      .select(
        "id, name, email, company, position, industry, bio, avatar_url, is_admin, is_active, is_agency, onboarding_step, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) {
      return jsonError(404, "NOT_FOUND", "ユーザーが見つかりません");
    }

    // 集計: connections / meetings / chats
    const [
      connectionsRes,
      meetingsRes,
      goalsRes,
      offeringsRes,
      auditRes,
    ] = await Promise.all([
      supabase
        .from("connections")
        .select("id", { count: "exact", head: true })
        .or(`user_id.eq.${id},connected_user_id.eq.${id}`),
      supabase
        .from("meeting_participants")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id),
      supabase
        .from("user_goals")
        .select("type, detail, created_at")
        .eq("user_id", id),
      supabase
        .from("user_offerings")
        .select("type, detail, created_at")
        .eq("user_id", id),
      supabase
        .from("audit_logs")
        .select("id, actor_id, action, target_type, target_id, payload, created_at")
        .or(`actor_id.eq.${id},and(target_type.eq.user,target_id.eq.${id})`)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // login_sessions は PII のためパスワード再認証が必要な別 endpoint に分離。
    // POST /api/v1/admin/users/[id]/login-sessions で取得する。
    const loginSessions: Array<Record<string, unknown>> = [];

    // 閲覧監査ログ (法務 R5: 失敗時は閲覧自体を拒否)。
    // 旧 fire-and-forget は Edge/Serverless で Promise が破棄されるため
    // INSERT が落ちて法的証跡が空になる事故が起きうる → await + 失敗時 500。
    const { error: auditErr } = await supabase
      .from("audit_logs")
      .insert({
        actor_id: user.id,
        action: "admin.view_user",
        target_type: "user",
        target_id: id,
        payload: { reason } as Json,
      });
    if (auditErr) {
      console.error("[admin/users/[id]] audit insert failed:", auditErr.message);
      return jsonError(
        500,
        "AUDIT_FAILED",
        "閲覧記録の保存に失敗したため詳細を表示できません。再試行してください。",
      );
    }

    return json({
      profile,
      counts: {
        connections: connectionsRes.count ?? 0,
        meetings: meetingsRes.count ?? 0,
      },
      goals: goalsRes.data ?? [],
      offerings: offeringsRes.data ?? [],
      recent_audit: (auditRes.data ?? []) as AuditLogRow[],
      login_sessions: loginSessions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
