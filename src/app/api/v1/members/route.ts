import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { sanitizeFilterValue } from "@/lib/sanitize";
import { expandSearchTerms, buildIlikeOrClause } from "@/lib/search/synonyms";

/**
 * /api/v1/members?q=...
 *
 * 検索戦略 (3層 fallback):
 *   1. **完全一致層** — 入力文字列をそのまま name/company/bio に ILIKE
 *      ("補助金" 入力 → "補助金" を含む人だけが hit)
 *   2. **同義語層 (semantic-lite)** — 完全一致 0件 or 不足時、辞書展開した
 *      関連キーワード ("補助金"→"助成"/"支援金"/"公募"/"採択") で OR 検索。
 *      embedding pgvector 並みではないが ILIKE 単独より大幅に再現性UP。
 *   3. **0件時** — meta.suggestions に「拡張で hit する語」を返却し、
 *      UI 側で「もしかして〇〇」サジェスト表示できる。
 *
 * embedding 完全版は別 PR で pgvector + profile_embeddings を導入予定。
 */
export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { searchParams } = new URL(request.url);
    const rawSearch = searchParams.get("q") ?? "";
    const search = sanitizeFilterValue(rawSearch);
    const industry = searchParams.get("industry");
    const position = searchParams.get("position");
    const sort = searchParams.get("sort") ?? "newest"; // score | newest | name
    const page = Number(searchParams.get("page") ?? "1");
    const limit = 20;
    const offset = (page - 1) * limit;

    const expandedTerms = search ? expandSearchTerms(search) : [];
    const usedSynonyms = expandedTerms.length > 1; // 元の文字列 + 同義語あり

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

      // search が truthy なら expandedTerms は必ず1要素以上 (元語含む)
      if (search) {
        scoreQuery = scoreQuery.or(
          buildIlikeOrClause(
            ["target_profile.name", "target_profile.company", "target_profile.bio"],
            expandedTerms,
          ),
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
          searchExpanded: usedSynonyms,
          searchTerms: expandedTerms,
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

    // search が truthy なら expandedTerms は必ず1要素以上 (元語含む)
    if (search) {
      query = query.or(
        buildIlikeOrClause(["name", "company", "bio"], expandedTerms),
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
        // 同義語展開された場合、UI 側で「補助金 → 助成・支援金 を含めて検索しています」と表示できる
        searchExpanded: usedSynonyms,
        searchTerms: expandedTerms,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
