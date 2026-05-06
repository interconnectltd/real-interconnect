import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "無効なユーザーIDです");
    }

    const { user, supabase } = await withAuth(request);

    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !profile) {
      return jsonError(404, "NOT_FOUND", "プロフィールが見つかりません");
    }

    // contact_info の可視性判定
    let canSeeContactInfo = id === user.id;

    if (!canSeeContactInfo) {
      const { data: connection } = await supabase
        .from("connections")
        .select("status")
        .or(
          `and(user_id.eq.${user.id},connected_user_id.eq.${id}),and(user_id.eq.${id},connected_user_id.eq.${user.id})`,
        )
        .in("status", ["accepted", "reaccepted"])
        .maybeSingle();

      if (connection) {
        canSeeContactInfo = true;
      } else {
        // 確認済み会議を共有しているかチェック
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
            canSeeContactInfo = true;
          }
        }
      }
    }

    if (canSeeContactInfo) {
      // contact_info が未設定ならメールアドレスをフォールバック
      if (!profile.contact_info && profile.email) {
        profile.contact_info = profile.email;
      }
    } else {
      // 連絡先を完全に隠す
      profile.contact_info = null;
    }

    // email はフロントエンドに返さない（自分のプロフィール以外）
    if (id !== user.id) {
      delete (profile as Record<string, unknown>).email;
    }

    return json(profile);
  } catch (error) {
    return handleApiError(error);
  }
}
