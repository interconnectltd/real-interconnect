import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { sanitizeFilterValue } from "@/lib/sanitize";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const { searchParams } = new URL(request.url);
    const rawSearch = searchParams.get("q") ?? "";
    const search = sanitizeFilterValue(rawSearch);
    const industry = searchParams.get("industry");
    const position = searchParams.get("position");
    const sort = searchParams.get("sort") ?? "newest"; // score | newest | name
    const page = Number(searchParams.get("page") ?? "1");
    const limit = 20;
    const offset = (page - 1) * limit;

    // For score sort, use matching_scores_v4 join
    if (sort === "score") {
      let scoreQuery = supabase
        .from("matching_scores_v4")
        .select(
          "total_score, target_profile:user_profiles!target_id(id, name, company, position, industry, bio, avatar_url)",
          { count: "exact" },
        )
        .eq("viewer_id", user.id)
        .gt("total_score", 0);

      if (search) {
        scoreQuery = scoreQuery.or(
          `target_profile.name.ilike.%${search}%,target_profile.company.ilike.%${search}%,target_profile.bio.ilike.%${search}%`,
        );
      }
      if (industry) {
        scoreQuery = scoreQuery.eq("target_profile.industry", industry);
      }
      if (position) {
        scoreQuery = scoreQuery.ilike("target_profile.position", `%${sanitizeFilterValue(position)}%`);
      }

      scoreQuery = scoreQuery
        .order("total_score", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: scoreData, error: scoreError, count: scoreCount } =
        (await scoreQuery) as {
          data: { total_score: number; target_profile: Record<string, unknown> }[] | null;
          error: Error | null;
          count: number | null;
        };
      if (scoreError) throw scoreError;

      const members = (scoreData ?? [])
        .filter((row) => row.target_profile != null)
        .map((row) => ({
          ...row.target_profile,
          matching_score: row.total_score,
        }));

      return json({
        members,
        meta: {
          page,
          totalPages: Math.ceil((scoreCount ?? 0) / limit),
          totalCount: scoreCount ?? 0,
        },
      });
    }

    // Default: newest / name sort via user_profiles directly
    let query = supabase
      .from("user_profiles")
      .select("id, name, company, position, industry, bio, avatar_url", {
        count: "exact",
      })
      .eq("is_active", true)
      .neq("id", user.id);

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,company.ilike.%${search}%,bio.ilike.%${search}%`,
      );
    }

    if (industry) {
      query = query.eq("industry", industry);
    }

    if (position) {
      query = query.ilike("position", `%${sanitizeFilterValue(position)}%`);
    }

    if (sort === "name") {
      query = query.order("name", { ascending: true });
    } else {
      // newest (default)
      query = query.order("created_at", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return json({
      members: data,
      meta: {
        page,
        totalPages: Math.ceil((count ?? 0) / limit),
        totalCount: count ?? 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
