import { withAuth, json, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get("sort") ?? "score";
    const minScore = Number(searchParams.get("min_score") ?? "0.35");
    const page = Number(searchParams.get("page") ?? "1");
    const limit = 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("matching_scores_v4")
      // PII 漏洩防止: 他人の email は payload に含めない (Sec audit Critical /matching)
      // self / 別人重複検出は server-side で完結させる前提 (compute-v2 で除外済)
      .select("*, target_profile:user_profiles!target_id(id, name, company, position, industry, bio, avatar_url)", { count: "exact" })
      .eq("viewer_id", user.id)
      // Defense-in-depth: 自分自身のペアを絶対にレスポンスに含めない
      // (compute-v2 で既に除外しているが、過去 row や手動 insert への保険)
      .neq("target_id", user.id)
      .gte("total_score", minScore);

    if (sortBy === "score") {
      query = query.order("total_score", { ascending: false });
    } else {
      query = query.order("calculated_at", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query as { data: Record<string, unknown>[] | null; error: Error | null; count: number | null };
    if (error) throw error;

    // Remap score_reasons (DB column) → reasons (frontend field)
    const mapped = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      reasons: Array.isArray(row.score_reasons) ? row.score_reasons : [],
    }));

    return json(mapped, 200);
  } catch (error) {
    return handleApiError(error);
  }
}
