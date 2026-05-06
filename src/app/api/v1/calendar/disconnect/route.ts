/**
 * POST /api/v1/calendar/disconnect?provider=google
 *
 * 連携解除: is_active=false + token を null クリア + audit-log。
 * (DELETE せず保持して履歴を残す。RLS の auth_delete_own_calendar 別経路で完全削除可)
 */

import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider") ?? "google";
    if (provider !== "google" && provider !== "microsoft") {
      return jsonError(400, "BAD_REQUEST", "未対応の provider");
    }

    const { error } = await supabase
      .from("calendar_connections")
      .update({
        is_active: false,
        access_token_enc: "",
        refresh_token_enc: null,
        token_expires_at: null,
        watch_channel_id: null,
        watch_resource_id: null,
        watch_expires_at: null,
      })
      .eq("user_id", user.id)
      .eq("provider", provider);

    if (error) throw error;

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "calendar.disconnect",
      target_type: "calendar_connection",
      target_id: null,
      payload: { provider },
      ip: client.ip,
      ua: client.ua,
    });

    return json({ disconnected: true });
  } catch (error) {
    return handleApiError(error);
  }
}
