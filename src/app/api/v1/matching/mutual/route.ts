import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { MATCHING_MUTUAL_THRESHOLD } from "@/lib/constants";

export async function GET() {
  try {
    const { user, supabase } = await withAuth();

    // Get scores where I score them >= threshold
    const { data: myScores, error: err1 } = await supabase
      .from("matching_scores_v3")
      .select("target_id, total_score, score_reasons")
      .eq("viewer_id", user.id)
      .gte("total_score", MATCHING_MUTUAL_THRESHOLD);

    if (err1) throw err1;
    if (!myScores?.length) return json([]);

    const targetIds = myScores.map((s) => s.target_id);

    // Get reverse scores where they also score me >= threshold
    const { data: theirScores, error: err2 } = await supabase
      .from("matching_scores_v3")
      .select("viewer_id, total_score, target_profile:user_profiles!viewer_id(id, name, company, position, industry, bio, avatar_url)")
      .eq("target_id", user.id)
      .in("viewer_id", targetIds)
      .gte("total_score", MATCHING_MUTUAL_THRESHOLD)
      .order("total_score", { ascending: false });

    if (err2) throw err2;

    // Combine both directions
    const mutualMatches = (theirScores ?? []).map((them) => {
      const mine = myScores.find((m) => m.target_id === them.viewer_id);
      return {
        user_id: them.viewer_id,
        my_score: mine?.total_score ?? 0,
        their_score: them.total_score,
        my_reasons: Array.isArray(mine?.score_reasons) ? mine.score_reasons : [],
        profile: them.target_profile,
      };
    });

    return json(mutualMatches);
  } catch (error) {
    return handleApiError(error);
  }
}
