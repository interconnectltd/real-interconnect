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

    // contact_info: only visible if connection is accepted OR shared confirmed meeting
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
        // Check if both users share a confirmed meeting
        let hasSharedMeeting = false;

        const { data: myMeetings } = await supabase
          .from("meeting_participants_v2")
          .select("meeting_id")
          .eq("user_id", user.id);

        const myMeetingIds = myMeetings?.map((m) => m.meeting_id) ?? [];

        if (myMeetingIds.length > 0) {
          const { data: sharedMeeting } = await supabase
            .from("meeting_participants_v2")
            .select("meeting_id, meetings!inner(status)")
            .eq("user_id", id)
            .in("meeting_id", myMeetingIds)
            .eq("meetings.status", "confirmed")
            .limit(1)
            .maybeSingle();

          if (sharedMeeting) {
            hasSharedMeeting = true;
          }
        }

        if (!hasSharedMeeting) {
          profile.contact_info = null;
          (profile as Record<string, unknown>).email = null;
        }
      }
    }

    // contact_info が未設定ならメールアドレスをフォールバック
    if (profile.contact_info === null && profile.email) {
      profile.contact_info = profile.email;
    }

    return json(profile);
  } catch (error) {
    return handleApiError(error);
  }
}
