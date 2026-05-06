/**
 * GET /api/v1/admin/dashboard
 *
 * 運営ダッシュボード用 KPI 集計。
 * 当面 users < 1万なら直 SQL で十分 (200ms 以内)。スケール時は SQL view + RPC 化。
 */

import {
  withAdminAuth,
  json,
  handleApiError,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface DashboardKpi {
  active_users_total: number;
  dau_24h: number;
  wau_7d: number;
  mau_30d: number;
  onboarding_completed: number;
  onboarding_in_progress: number;
  onboarding_completion_rate: number;
  connections_accepted_total: number;
  connections_pending: number;
  matches_total: number;
  pending_import_requests: number;
  transcript_errors: number;
  incomplete_profiles: number;
}

export async function GET(request: Request) {
  try {
    const { supabase } = await withAdminAuth(request);

    // 各 KPI を並列で取得 (Promise.all で 6 並列、レスポンス 200ms 以内)
    const [
      profilesRes,
      auditDayRes,
      auditWeekRes,
      auditMonthRes,
      connectionsAcceptedRes,
      connectionsPendingRes,
      matchesRes,
      importPendingRes,
      transcriptErrorsRes,
      incompleteProfileRes,
    ] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("id, onboarding_step, industry, bio", { count: "exact", head: false })
        .eq("is_active", true),
      // DAU: 過去 24h (audit_logs.actor_id 由来)
      supabase
        .from("audit_logs")
        .select("actor_id")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from("audit_logs")
        .select("actor_id")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from("audit_logs")
        .select("actor_id")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("status", "accepted"),
      supabase
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("matching_scores_v4")
        .select("viewer_id", { count: "exact", head: true })
        .gt("total_score", 0),
      supabase
        .from("meeting_data_import_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("meeting_transcripts")
        .select("id", { count: "exact", head: true })
        .eq("status", "error"),
      supabase
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .or("industry.is.null,bio.is.null"),
    ]);

    type Profile = { id: string; onboarding_step: number | null };
    const profiles = (profilesRes.data as Profile[] | null) ?? [];
    const totalProfiles = profiles.length;
    const completed = profiles.filter((p) => (p.onboarding_step ?? 0) >= 3).length;

    // DAU/WAU/MAU は distinct actor_id を JS で集計
    type Row = { actor_id: string | null };
    const distinct = (rows: Row[]) =>
      new Set(rows.map((r) => r.actor_id).filter((v): v is string => v !== null)).size;

    const kpi: DashboardKpi = {
      active_users_total: totalProfiles,
      dau_24h: distinct((auditDayRes.data as Row[] | null) ?? []),
      wau_7d: distinct((auditWeekRes.data as Row[] | null) ?? []),
      mau_30d: distinct((auditMonthRes.data as Row[] | null) ?? []),
      onboarding_completed: completed,
      onboarding_in_progress: Math.max(0, totalProfiles - completed),
      onboarding_completion_rate:
        totalProfiles === 0 ? 0 : Math.round((completed / totalProfiles) * 100) / 100,
      connections_accepted_total: connectionsAcceptedRes.count ?? 0,
      connections_pending: connectionsPendingRes.count ?? 0,
      matches_total: matchesRes.count ?? 0,
      pending_import_requests: importPendingRes.count ?? 0,
      transcript_errors: transcriptErrorsRes.count ?? 0,
      incomplete_profiles: incompleteProfileRes.count ?? 0,
    };

    return json(kpi);
  } catch (error) {
    return handleApiError(error);
  }
}
