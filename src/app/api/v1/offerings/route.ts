import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { GOAL_TYPES } from "@/lib/constants";

const validTypes = new Set<string>(GOAL_TYPES.map((g) => g.value));

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { data, error } = await supabase
      .from("user_offerings")
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

    if (!Array.isArray(body?.offerings)) {
      return jsonError(400, "BAD_REQUEST", "offerings配列が必要です");
    }

    const offerings = (body.offerings as { type: string; context?: string }[]).filter(
      (o) => o.type && validTypes.has(o.type),
    );

    if (offerings.length === 0) {
      return jsonError(400, "BAD_REQUEST", "最低1つの提供物を選択してください");
    }

    await supabase.from("user_offerings").delete().eq("user_id", user.id);

    const rows = offerings.map((o: { type: string; context?: string }) => ({
      user_id: user.id,
      type: o.type,
      context: o.context ?? null,
      source: "manual",
    }));

    const { data, error } = await supabase
      .from("user_offerings")
      .insert(rows)
      .select();

    if (error) throw error;
    return json(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
