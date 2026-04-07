import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { profileUpdateSchema } from "@/validations/profile";

export async function GET() {
  try {
    const { user, supabase } = await withAuth();

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      return jsonError(404, "NOT_FOUND", "プロフィールが見つかりません");
    }

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await withAuth();
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
