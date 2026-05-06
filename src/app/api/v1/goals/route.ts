import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { GOAL_TYPES } from "@/lib/constants";

const validTypes = new Set<string>(GOAL_TYPES.map((g) => g.value));

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { data, error } = await supabase
      .from("user_goals")
      .select("*")
      .eq("user_id", user.id);
    if (error) throw error;
    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const body = await request.json().catch(() => null);

    if (!Array.isArray(body?.goals)) {
      return jsonError(400, "BAD_REQUEST", "goals配列が必要です");
    }

    const goals = (body.goals as { type: string; context?: string }[]).filter(
      (g) => g.type && validTypes.has(g.type),
    );

    if (goals.length === 0) {
      return jsonError(400, "BAD_REQUEST", "最低1つの目的を選択してください");
    }

    // 既存を削除して再作成
    await supabase.from("user_goals").delete().eq("user_id", user.id);

    const rows = goals.map((g: { type: string; context?: string }) => ({
      user_id: user.id,
      type: g.type,
      context: g.context ?? null,
      source: "manual",
    }));

    const { data, error } = await supabase
      .from("user_goals")
      .insert(rows)
      .select();

    if (error) throw error;
    return json(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
