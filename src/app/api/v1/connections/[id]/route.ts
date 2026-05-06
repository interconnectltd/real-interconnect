import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["accepted", "declined", "cancelled"],
  accepted: ["disconnected", "blocked"],
  declined: ["pending"],
  cancelled: ["pending"],
  disconnected: ["pending"],
  blocked: [],
  reaccepted: ["disconnected", "blocked"],
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabase } = await withAuth(request);
    const { status: newStatus } = await request.json();

    // Fetch existing connection
    const { data: connection, error: fetchError } = await supabase
      .from("connections")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !connection) {
      return jsonError(404, "NOT_FOUND", "コネクションが見つかりません");
    }

    // Verify user is part of this connection
    if (connection.user_id !== user.id && connection.connected_user_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "このコネクションを操作する権限がありません");
    }

    // Direction check: accept/reject can only be done by the RECIPIENT
    if (
      (newStatus === "accepted" || newStatus === "declined") &&
      connection.connected_user_id !== user.id
    ) {
      return jsonError(403, "FORBIDDEN", "承認・拒否は申請を受けた側のみ実行できます");
    }

    // cancel can only be done by the SENDER
    if (newStatus === "cancelled" && connection.user_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "取消は申請した側のみ実行できます");
    }

    // Validate state transition
    const allowed = VALID_TRANSITIONS[connection.status];
    if (!allowed?.includes(newStatus)) {
      return jsonError(
        400,
        "INVALID_TRANSITION",
        `${connection.status} から ${newStatus} への変更はできません`,
      );
    }

    const { data, error } = await supabase
      .from("connections")
      .update({ status: newStatus })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Notify on acceptance
    if (newStatus === "accepted") {
      const recipientId =
        connection.user_id === user.id
          ? connection.connected_user_id
          : connection.user_id;

      const serviceClient = await createServiceClient();
      await serviceClient.from("notifications").insert({
        user_id: recipientId,
        type: "contact_exchange" as const,
        title: "つながりが成立しました",
        message: "コネクションが承認され、連絡先を交換できるようになりました",
        link: "/connections",
      });
    }

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
