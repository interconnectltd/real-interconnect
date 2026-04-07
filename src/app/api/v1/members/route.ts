import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { sanitizeFilterValue } from "@/lib/sanitize";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const { searchParams } = new URL(request.url);
    const rawSearch = searchParams.get("q") ?? "";
    const search = sanitizeFilterValue(rawSearch);
    const industry = searchParams.get("industry");
    const page = Number(searchParams.get("page") ?? "1");
    const limit = 20;
    const offset = (page - 1) * limit;

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

    query = query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

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
