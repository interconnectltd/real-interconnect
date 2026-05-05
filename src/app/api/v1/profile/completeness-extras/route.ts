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
      { data: analyzedRows },
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
      // distinct な transcript_id をカウント (同一 transcript に複数 speaker で
      // 紐付いた場合の二重カウント回避)。onboarding/internal は除外。
      supabase
        .from("meeting_participants")
        .select(
          "transcript_id, transcript:meeting_transcripts!inner(status, meeting_kind)",
        )
        .eq("user_id", user.id)
        .in("transcript.status", ["analyzed", "ready"])
        .neq("transcript.meeting_kind", "onboarding")
        .neq("transcript.meeting_kind", "internal"),
    ]);

    // distinct transcript_id 数を JS 側で計算
    const distinctTranscripts = new Set(
      ((analyzedRows ?? []) as { transcript_id: string }[]).map(
        (r) => r.transcript_id,
      ),
    );

    return json({
      goals: goalsCount ?? 0,
      offerings: offeringsCount ?? 0,
      consent_at: (profile as { contact_sharing_consent_at?: string | null } | null)
        ?.contact_sharing_consent_at ?? null,
      analyzed_count: distinctTranscripts.size,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
