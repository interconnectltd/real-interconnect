import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { profileUpdateSchema } from "@/validations/profile";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      return jsonError(404, "NOT_FOUND", "プロフィールが見つかりません");
    }

    // AI分析回数を取得
    const { data: aiProfile } = await supabase
      .from("member_ai_profiles_v2")
      .select("analysis_count, last_analyzed_at")
      .eq("user_id", user.id)
      .maybeSingle();

    return json({ ...data, analysis_count: aiProfile?.analysis_count ?? 0, last_analyzed_at: aiProfile?.last_analyzed_at ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const body = await request.json();
    const parsed = profileUpdateSchema.parse(body);

    const { data, error } = await supabase
      .from("user_profiles")
      .update(parsed)
      .eq("id", user.id)
      .select()
      .single();

    if (error) throw error;
    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
