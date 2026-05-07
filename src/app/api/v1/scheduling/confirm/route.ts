/**
 * POST /api/v1/scheduling/confirm
 *
 * 提案された時間を確定 → Google Meet event 自動生成 → chat に meeting_confirmed 投稿。
 *
 * Body:
 *   { other_user_id, room_id, start, end, summary?, description?, platform: 'google_meet' | 'zoom_pmi', zoom_pmi_url? }
 *
 * 認証必須、connection 成立済 + 同 room の member。
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
  checkDbRateLimit,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";
import { getValidGoogleAccessToken } from "@/lib/calendar/access-token";
import { createMeetEvent } from "@/lib/calendar/google";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import type { MeetingConfirmedPayload } from "@/types/calendar";
import type { Json } from "@/types/database";

const ConfirmSchema = z.object({
  other_user_id: z.string().refine(isValidUUID),
  room_id: z.string().refine(isValidUUID),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  summary: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  // "manual" は Calendar 連携不要 path (Wave12: Calendar 未連携 user の dead-end 解消)
  // meeting_url は manual_url 経由で user 提供、 もしくは未設定で URL 後共有
  platform: z.enum(["google_meet", "zoom_pmi", "manual"]),
  zoom_pmi_url: z.url().optional(),
  manual_url: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request, {
      skipMemoryRl: true,
      burstLimit: { perSecond: 2 },
    });
    const allowed = await checkDbRateLimit(
      supabase,
      user.id,
      "scheduling.confirm",
      10,
      60,
      true,
    );
    if (!allowed) return jsonError(429, "RATE_LIMITED", "リクエスト過多");

    const raw: unknown = await request.json().catch(() => null);
    const parsed = ConfirmSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }
    const data = parsed.data;
    if (data.platform === "zoom_pmi" && !data.zoom_pmi_url) {
      return jsonError(400, "BAD_REQUEST", "zoom_pmi_url が必須");
    }
    // "manual" は manual_url が optional で OK (URL 後共有 / 対面 ケース)

    // Room メンバー確認
    const { data: room } = await supabase
      .from("chat_rooms")
      .select("id, user_a_id, user_b_id")
      .eq("id", data.room_id)
      .maybeSingle();
    if (!room) return jsonError(404, "NOT_FOUND", "ルーム未発見");
    if (room.user_a_id !== user.id && room.user_b_id !== user.id) {
      return jsonError(403, "FORBIDDEN", "ルームメンバーではありません");
    }
    if (
      room.user_a_id !== data.other_user_id &&
      room.user_b_id !== data.other_user_id
    ) {
      return jsonError(403, "FORBIDDEN", "相手とルームが一致しません");
    }

    // 相手プロフィール取得 (招待 attendee email 用)
    const { data: otherProfile } = await supabase
      .from("user_profiles")
      .select("id, name, email")
      .eq("id", data.other_user_id)
      .maybeSingle();

    let meetingUrl: string;
    let calendarEventId = "";

    if (data.platform === "google_meet") {
      // proposer (=user) の Google calendar で event 作成
      const sb = await createServiceClient();
      const tok = await getValidGoogleAccessToken(sb, user.id);
      if (!tok) {
        return jsonError(
          400,
          "CALENDAR_NOT_CONNECTED",
          "Google Calendar が未連携です",
        );
      }
      const event = await createMeetEvent({
        accessToken: tok.accessToken,
        summary: data.summary ?? `1on1: ${otherProfile?.name ?? "相手"}`,
        description: data.description,
        start: data.start,
        end: data.end,
        attendees: otherProfile?.email
          ? [{ email: otherProfile.email, displayName: otherProfile.name ?? undefined }]
          : [],
      });
      meetingUrl = event.hangoutLink ?? event.htmlLink;
      calendarEventId = event.id;
    } else if (data.platform === "zoom_pmi") {
      // zoom_pmi: 既存 PMI URL を使用
      meetingUrl = data.zoom_pmi_url!;
    } else {
      // manual: Calendar 連携なし、 URL は user が後で共有 / 対面 / 既存 Meet 等
      // meeting_confirmed メッセージは投稿するが calendar event は作らない
      meetingUrl = data.manual_url ?? "";
      calendarEventId = "";
    }

    // chat に meeting_confirmed 投稿
    const payload: MeetingConfirmedPayload = {
      schema_version: 1,
      proposal_id: crypto.randomUUID(),
      calendar_event_id_organizer: calendarEventId,
      meeting_url: meetingUrl,
      start: data.start,
      end: data.end,
    };
    const platformLabel =
      data.platform === "google_meet"
        ? "Google Meet"
        : data.platform === "zoom_pmi"
        ? "Zoom"
        : "URL は後で共有";
    const { data: msg, error: msgErr } = await supabase
      .from("chat_messages")
      .insert({
        room_id: data.room_id,
        sender_id: user.id,
        content: `${formatJa(data.start)} 〜 ${formatJa(data.end)} に確定 (${platformLabel})`,
        content_type: "meeting_confirmed",
        payload: payload as unknown as Json,
      })
      .select(
        "id, room_id, sender_id, content, content_type, payload, is_read, created_at",
      )
      .single();
    if (msgErr) throw msgErr;

    // audit-log
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "calendar.event.create",
      target_type: "calendar_event",
      target_id: calendarEventId || null,
      payload: {
        platform: data.platform,
        room_id: data.room_id,
        start: data.start,
      },
      ip: client.ip,
      ua: client.ua,
    });

    return json({ message: msg, meeting_url: meetingUrl }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

function formatJa(iso: string): string {
  // ★Wave12 MED-1: 旧実装は server timezone 依存 (Vercel/Netlify は UTC) で
  // 9 時間ズレた chat 文言を投稿していた。Asia/Tokyo 明示で根治。
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
