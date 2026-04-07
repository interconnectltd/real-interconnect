import { withAuth, json, handleApiError } from "@/lib/api-helpers";

/** GET /api/v1/meetings — 自分の会議一覧 */
export async function GET() {
  try {
    const { user, supabase } = await withAuth();

    // meeting_participants_v2 経由で自分が参加する会議を取得
    const { data, error } = await supabase
      .from("meeting_participants_v2")
      .select(`
        meeting_id,
        role,
        meeting:meetings(
          id, title, scheduled_at, duration_min, platform, meeting_url, status,
          request:meeting_requests(requester_id, target_id, message)
        )
      `)
      .eq("user_id", user.id)
      .order("meeting_id", { ascending: false });

    if (error) throw error;

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
