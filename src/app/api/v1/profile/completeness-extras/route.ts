import { withAuth, json, handleApiError } from "@/lib/api-helpers";

/**
 * /api/v1/profile/completeness-extras
 *
 * Profile 完成度計算で必要な「Profile 外」のメトリクスをまとめて返却。
 *   - user_goals 件数
 *   - user_offerings 件数
 *   - 第三者提供同意の取得日時
 *   - tl;dv 解析済 transcripts 件数 (本人 participant が紐付き済かつ analyzed)
 */
export async function GET() {
  try {
    const { user, supabase } = await withAuth();

    const [
      { count: goalsCount },
      { count: offeringsCount },
      { data: profile },
      { count: analyzedCount },
    ] = await Promise.all([
      supabase
        .from("user_goals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("user_offerings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("user_profiles")
        .select("contact_sharing_consent_at")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("meeting_participants")
        .select(
          "id, transcript:meeting_transcripts!inner(status)",
          { count: "exact", head: true },
        )
        .eq("user_id", user.id)
        .eq("transcript.status", "analyzed"),
    ]);

    return json({
      goals: goalsCount ?? 0,
      offerings: offeringsCount ?? 0,
      consent_at: (profile as { contact_sharing_consent_at?: string | null } | null)
        ?.contact_sharing_consent_at ?? null,
      analyzed_count: analyzedCount ?? 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
