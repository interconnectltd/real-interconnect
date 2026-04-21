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
          request:meeting_requests(requester_id, target_id, message, proposed_times)
        )
      `)
      .eq("user_id", user.id)
      .order("meeting_id", { ascending: false });

    if (error) throw error;

    // 相手の参加者プロフィールを取得
    const meetingIds =
      data?.map((d: { meeting_id: string }) => d.meeting_id).filter(Boolean) ??
      [];

    let participantMap = new Map<
      string,
      { id: string; name: string | null; company: string | null; position: string | null } | null
    >();

    if (meetingIds.length > 0) {
      const { data: otherParticipants } = await supabase
        .from("meeting_participants_v2")
        .select(
          "meeting_id, user_id, user_profiles(id, name, company, position)"
        )
        .in("meeting_id", meetingIds)
        .neq("user_id", user.id);

      participantMap = new Map(
        otherParticipants?.map(
          (p: { meeting_id: string; user_profiles: unknown }) => [
            p.meeting_id,
            p.user_profiles as {
              id: string;
              name: string | null;
              company: string | null;
              position: string | null;
            } | null,
          ]
        ) ?? []
      );
    }

    // 各会議に相手の参加者情報を追加
    const enriched = data?.map(
      (d: { meeting_id: string; [key: string]: unknown }) => ({
        ...d,
        other_participant: participantMap.get(d.meeting_id) ?? null,
      })
    );

    return json(enriched);
  } catch (error) {
    return handleApiError(error);
  }
}
