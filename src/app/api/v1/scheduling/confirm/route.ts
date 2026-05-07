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
  // ★Wave13 #6: manual_url は将来 href 化される (MeetingConfirmedCard) ので
  //   javascript:/data:/vbscript: 等の XSS protocol を validation 段階で弾く。
  //   z.url() は最低限の URL 形式チェック、 refine で http/https のみ許可。
  manual_url: z
    .url()
    .max(500)
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "manual_url は http/https のみ許可" },
    )
    .optional(),
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

    // ★Wave13 #1: connection 成立確認 (suggest と権限非対称だった)
    //   chat_room はマッチング受諾で生成されるが、その後 connection が解除/ブロックされた
    //   room でも以前は Meet event 作成可能 → ブロック後の Meet 強制送付経路が空いていた。
    const { data: connection } = await supabase
      .from("connections")
      .select("id, status")
      .or(
        `and(user_id.eq.${user.id},connected_user_id.eq.${data.other_user_id}),and(user_id.eq.${data.other_user_id},connected_user_id.eq.${user.id})`,
      )
      .in("status", ["accepted", "reaccepted"])
      .maybeSingle();
    if (!connection) {
      return jsonError(403, "FORBIDDEN", "未接続のユーザーです");
    }

    // ★Wave13 R2 #1: Idempotency (二重 Meet event / 二重 chat 投稿防止)
    //   旧実装は (room_id, sender_id, payload->>start, payload->>end) 完全一致で hit
    //   判定していたが、 reload→再 suggest で start の秒/ミリ秒が前回と異なるため
    //   主要な「reload→再決定」ユースケースで idempotency が外れていた。
    //   1on1 room では 5 分以内の (room_id, sender_id, content_type=meeting_confirmed) が
    //   1 件でもあれば「重複確定」とみなしても誤判定リスクは無い (同 user が同 room で
    //   5 分以内に異なる日程を 2 件確定する想定は無い)。 粗い判定で実効性を最大化。
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: dupMsg } = await supabase
      .from("chat_messages")
      .select(
        "id, room_id, sender_id, content, content_type, payload, is_read, created_at",
      )
      .eq("room_id", data.room_id)
      .eq("sender_id", user.id)
      .eq("content_type", "meeting_confirmed")
      .gte("created_at", fiveMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dupMsg) {
      const dupPayload = (dupMsg.payload as unknown as MeetingConfirmedPayload | null) ?? null;
      // ★Wave13 R3 #5: 5 分以内に「同じ日程」を再 POST → idempotent return (二重防止)
      //   5 分以内に「異なる日程」を再 POST → 409 (やり直し直前で混乱防止)
      //   分単位 (秒以下無視) で start/end を比較。 suggest 側 slot は 15 分境界なので
      //   reload→再 suggest による秒のブレも吸収しつつ別日程は弾ける。
      const dupStartMin = (dupPayload?.start ?? "").slice(0, 16);
      const dupEndMin = (dupPayload?.end ?? "").slice(0, 16);
      const sameStart = dupStartMin === data.start.slice(0, 16);
      const sameEnd = dupEndMin === data.end.slice(0, 16);
      if (!sameStart || !sameEnd) {
        return jsonError(
          409,
          "ALREADY_CONFIRMED",
          `直近 5 分以内に別の日程 (${formatJa(dupPayload?.start ?? data.start)} 〜 ${formatJa(dupPayload?.end ?? data.end)}) が確定済みです。変更する場合は確定済カードを取消してから再操作してください。`,
        );
      }
      // R2: idempotent fall-through も audit に記録 (旧実装は audit 抜け)
      const client = extractClientInfo(request);
      void writeAuditLog(supabase, {
        actor_id: user.id,
        action: "calendar.event.create",
        target_type: "calendar_event",
        target_id: dupPayload?.calendar_event_id_organizer || null,
        payload: {
          platform: data.platform,
          room_id: data.room_id,
          start: data.start,
          idempotent: true,
        },
        ip: client.ip,
        ua: client.ua,
      });
      return json(
        {
          message: dupMsg,
          meeting_url: dupPayload?.meeting_url ?? "",
          idempotent: true,
        },
        200,
      );
    }

    // 相手プロフィール取得 (招待 attendee email 用)
    const { data: otherProfile } = await supabase
      .from("user_profiles")
      .select("id, name, email")
      .eq("id", data.other_user_id)
      .maybeSingle();

    let meetingUrl: string;
    let calendarEventId = "";
    // 実際に確定された platform (google_meet を要求しても calendar 未連携で manual に
    // silent fallback した場合、 chat 表示は manual ラベルにする)
    let resolvedPlatform: "google_meet" | "zoom_pmi" | "manual" = data.platform;

    if (data.platform === "google_meet") {
      // proposer (=user) の Google calendar で event 作成
      const sb = await createServiceClient();
      const tok = await getValidGoogleAccessToken(sb, user.id);
      if (!tok) {
        // ★Wave12: Calendar 未連携でも 400 で死なせない silent fallback
        //   旧実装は CALENDAR_NOT_CONNECTED で 400 → frontend で再 POST → 400 1 件残る UX
        //   新実装: server 側で manual 相当に内部 fallback、 chat には「URL は後で共有」表示
        meetingUrl = data.manual_url ?? "";
        calendarEventId = "";
        resolvedPlatform = "manual";
      } else {
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
      }
    } else if (data.platform === "zoom_pmi") {
      meetingUrl = data.zoom_pmi_url!;
    } else {
      // manual: 直接 manual で来たケース
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
    // resolvedPlatform を見て chat の文言切替 (silent fallback 時に「Google Meet」と
    // 嘘表記しない)
    const platformLabel =
      resolvedPlatform === "google_meet"
        ? "Google Meet"
        : resolvedPlatform === "zoom_pmi"
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
