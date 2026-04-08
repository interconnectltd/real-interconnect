import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";

/** PATCH /api/v1/meetings/[id] — 会議ステータス更新 (confirm/cancel/complete) */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidUUID(id)) return jsonError(400, "BAD_REQUEST", "無効なIDです");

    const { user, supabase } = await withAuth();
    const body = await request.json().catch(() => null);
    const newStatus = body?.status;

    if (!newStatus || !["confirmed", "cancelled", "completed", "no_show"].includes(newStatus)) {
      return jsonError(400, "BAD_REQUEST", "有効なステータスを指定してください");
    }

    // 会議の存在+参加者チェック
    const { data: participant } = await supabase
      .from("meeting_participants_v2")
      .select("meeting_id")
      .eq("meeting_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!participant) {
      return jsonError(403, "FORBIDDEN", "この会議を操作する権限がありません");
    }

    const { data, error } = await supabase
      .from("meetings")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // confirmed 時に相手に通知
    if (newStatus === "confirmed") {
      const { data: allParticipants } = await supabase
        .from("meeting_participants_v2")
        .select("user_id")
        .eq("meeting_id", id)
        .neq("user_id", user.id);

      const serviceClient = await createServiceClient();
      for (const p of allParticipants ?? []) {
        await serviceClient.from("notifications").insert({
          user_id: p.user_id,
          type: "meeting_confirmed",
          title: "会議が確定しました",
          message: `${data.title ?? "会議"}の日程が確定しました`,
          link: "/meetings",
        });
      }
    }

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
