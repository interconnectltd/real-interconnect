import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "無効なユーザーIDです");
    }

    const { user, supabase } = await withAuth();

    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !profile) {
      return jsonError(404, "NOT_FOUND", "プロフィールが見つかりません");
    }

    // contact_info: only visible if connection is accepted
    if (id !== user.id) {
      const { data: connection } = await supabase
        .from("connections")
        .select("status")
        .or(
          `and(user_id.eq.${user.id},connected_user_id.eq.${id}),and(user_id.eq.${id},connected_user_id.eq.${user.id})`,
        )
        .eq("status", "accepted")
        .maybeSingle();

      if (!connection) {
        profile.contact_info = null;
      }
    }

    return json(profile);
  } catch (error) {
    return handleApiError(error);
  }
}
