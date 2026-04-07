import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET() {
  try {
    const { user, supabase } = await withAuth();

    const { data, error } = await supabase
      .from("bookmarks")
      .select("*, profile:user_profiles!bookmarked_user_id(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const { bookmarked_user_id, note } = await request.json();

    if (!bookmarked_user_id) {
      return jsonError(400, "BAD_REQUEST", "ブックマーク対象のユーザーIDが必要です");
    }

    const { data, error } = await supabase
      .from("bookmarks")
      .upsert(
        { user_id: user.id, bookmarked_user_id, note },
        { onConflict: "user_id,bookmarked_user_id" },
      )
      .select()
      .single();

    if (error) throw error;
    return json(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const { searchParams } = new URL(request.url);
    const bookmarkedUserId = searchParams.get("bookmarked_user_id");

    if (!bookmarkedUserId) {
      return jsonError(400, "BAD_REQUEST", "bookmarked_user_id パラメータが必要です");
    }

    const { error } = await supabase
      .from("bookmarks")
      .delete()
      .eq("user_id", user.id)
      .eq("bookmarked_user_id", bookmarkedUserId);

    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
