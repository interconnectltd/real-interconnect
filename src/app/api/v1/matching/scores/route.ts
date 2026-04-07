import { withAuth, json, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get("sort") ?? "score";
    const minScore = Number(searchParams.get("min_score") ?? "0.35");
    const page = Number(searchParams.get("page") ?? "1");
    const limit = 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("matching_scores_v3")
      .select("*, target_profile:user_profiles!target_id(*)", { count: "exact" })
      .eq("viewer_id", user.id)
      .gte("total_score", minScore);

    if (sortBy === "score") {
      query = query.order("total_score", { ascending: false });
    } else {
      query = query.order("calculated_at", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    // Remap score_reasons (DB column) → reasons (frontend field)
    const mapped = (data ?? []).map((row) => ({
      ...row,
      reasons: Array.isArray(row.score_reasons) ? row.score_reasons : [],
    }));

    return json(mapped, 200);
  } catch (error) {
    return handleApiError(error);
  }
}
