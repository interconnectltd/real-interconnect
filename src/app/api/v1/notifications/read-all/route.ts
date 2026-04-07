import { withAuth, json, handleApiError } from "@/lib/api-helpers";

export async function PATCH() {
  try {
    const { user, supabase } = await withAuth();

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);

    if (error) throw error;

    return json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
