import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";

/** POST /api/v1/meetings/request — 会議リクエスト送信 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const body = await request.json().catch(() => null);

    if (!body?.target_id || !isValidUUID(body.target_id)) {
      return jsonError(400, "BAD_REQUEST", "有効な相手のIDが必要です");
    }

    if (body.target_id === user.id) {
      return jsonError(400, "BAD_REQUEST", "自分自身には会議リクエストを送れません");
    }

    // 対象ユーザー存在確認
    const { data: target } = await supabase
      .from("user_profiles")
      .select("id, name")
      .eq("id", body.target_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!target) {
      return jsonError(404, "NOT_FOUND", "対象のユーザーが見つかりません");
    }

    const { data: requestData, error: reqError } = await supabase
      .from("meeting_requests")
      .insert({
        requester_id: user.id,
        target_id: body.target_id,
        message: body.message ?? null,
        proposed_times: body.proposed_times ?? [],
        status: "proposed",
      })
      .select()
      .single();

    if (reqError) throw reqError;

    // Create meeting record linked to this request
    const serviceClient = await createServiceClient();
    const { data: meeting, error: meetingError } = await serviceClient
      .from("meetings")
      .insert({
        request_id: requestData.id,
        title: `${target.name}との会議`,
        scheduled_at: new Date().toISOString(),
        status: "proposed",
        duration_min: 30,
      })
      .select()
      .single();

    if (meetingError) throw meetingError;

    // Add both users as participants
    await serviceClient.from("meeting_participants_v2").insert([
      { meeting_id: meeting.id, user_id: user.id, role: "requester" },
      { meeting_id: meeting.id, user_id: body.target_id, role: "target" },
    ]);

    // 通知
    await serviceClient.from("notifications").insert({
      user_id: body.target_id,
      type: "meeting_request",
      title: "会議リクエスト",
      message: `新しい会議リクエストが届いています`,
      link: "/meetings",
    });

    return json(requestData, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
