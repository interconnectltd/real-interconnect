/**
 * GET /api/v1/calendar/feed/[token] — ICS フィード配信 (token 認証、anon でアクセス可)
 *
 * 認証は token のみ (Google Calendar / Outlook 等の subscription URL 用)。
 * token が revoked または存在しない場合 404。
 *
 * 配信内容: 該当 user の確定済 (status='confirmed') meetings を VEVENT として返す。
 * 過去 30 日 + 未来 365 日のレンジで枝刈り。
 */

import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface FeedTokenRow {
  user_id: string;
}

interface MeetingRow {
  id: string;
  title: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  meet_url: string | null;
  status: string;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsDate(iso: string): string {
  // YYYYMMDDTHHMMSSZ
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 32 || token.length > 200) {
    return new Response("Not found", { status: 404 });
  }

  // 公開 endpoint だが token 検証は service_role でテーブル直アクセス
  const supabase = await createServiceClient();

  type LooseSelect<T> = {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          is: (col: string, val: unknown) => {
            maybeSingle: () => Promise<{
              data: T | null;
              error: { message?: string } | null;
            }>;
          };
          gte?: (col: string, val: unknown) => {
            lte: (col: string, val: unknown) => {
              order: (col: string, opt: { ascending: boolean }) => Promise<{
                data: MeetingRow[] | null;
                error: { message?: string } | null;
              }>;
            };
          };
        };
      };
    };
  };

  const { data: row, error: tErr } = await (
    supabase as unknown as LooseSelect<FeedTokenRow>
  )
    .from("user_calendar_feed_tokens")
    .select("user_id")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (tErr || !row) {
    return new Response("Not found", { status: 404 });
  }
  const userId = row.user_id;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  type MeetSelect = {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => {
            gte: (col: string, val: unknown) => {
              lte: (col: string, val: unknown) => {
                order: (col: string, opt: { ascending: boolean }) => Promise<{
                  data: MeetingRow[] | null;
                  error: { message?: string } | null;
                }>;
              };
            };
          };
        };
      };
    };
  };

  const { data: meetings } = await (supabase as unknown as MeetSelect)
    .from("meetings")
    .select(
      "id, title, scheduled_start_at, scheduled_end_at, meet_url, status",
    )
    .eq("organizer_id", userId)
    .eq("status", "confirmed")
    .gte("scheduled_start_at", since)
    .lte("scheduled_start_at", until)
    .order("scheduled_start_at", { ascending: true });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//INTER CONNECT//ICS feed//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:INTER CONNECT",
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];

  for (const m of meetings ?? []) {
    if (!m.scheduled_start_at) continue;
    const start = m.scheduled_start_at;
    const end = m.scheduled_end_at ?? new Date(
      new Date(start).getTime() + 30 * 60 * 1000,
    ).toISOString();
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${m.id}@inter-connect.app`);
    lines.push(`DTSTAMP:${toIcsDate(new Date().toISOString())}`);
    lines.push(`DTSTART:${toIcsDate(start)}`);
    lines.push(`DTEND:${toIcsDate(end)}`);
    lines.push(`SUMMARY:${escapeIcsText(m.title ?? "INTER CONNECT meeting")}`);
    if (m.meet_url) {
      lines.push(`URL:${escapeIcsText(m.meet_url)}`);
      lines.push(`DESCRIPTION:${escapeIcsText("Meet: " + m.meet_url)}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
