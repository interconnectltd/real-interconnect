/**
 * "Add to calendar" URL builders for Google Calendar and Outlook (Office 365 / Outlook.com).
 *
 * Both providers accept an HTTP GET URL with query params that pre-fills a new
 * event creation form. The user still has to click "Save" in their calendar.
 */

export type CalendarMeetingInput = {
  id: string;
  title: string | null;
  scheduled_at: string | null;
  duration_min: number | null;
  platform?: string | null;
  meeting_url?: string | null;
  participants?: string[];
};

const DEFAULT_DURATION_MIN = 30;

function resolveTitle(input: CalendarMeetingInput): string {
  if (input.title && input.title.trim()) return input.title.trim();
  if (input.platform) return `${input.platform} Meeting`;
  return "Meeting";
}

function resolveDescription(input: CalendarMeetingInput): string {
  const lines: string[] = [];
  if (input.platform) lines.push(`Platform: ${input.platform}`);
  if (input.meeting_url) lines.push(`Join: ${input.meeting_url}`);
  if (input.participants && input.participants.length) {
    lines.push(`Participants: ${input.participants.join(", ")}`);
  }
  lines.push("");
  lines.push("via INTER CONNECT");
  return lines.join("\n");
}

function resolveTimeRange(input: CalendarMeetingInput): { start: Date; end: Date } | null {
  if (!input.scheduled_at) return null;
  const start = new Date(input.scheduled_at);
  if (Number.isNaN(start.getTime())) return null;
  const durationMin = input.duration_min && input.duration_min > 0 ? input.duration_min : DEFAULT_DURATION_MIN;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return { start, end };
}

/**
 * Format a Date as YYYYMMDDTHHmmssZ (Google Calendar URL convention).
 */
function toGoogleDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * https://calendar.google.com/calendar/render?action=TEMPLATE&...
 */
export function generateGoogleCalendarUrl(input: CalendarMeetingInput): string {
  const range = resolveTimeRange(input);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: resolveTitle(input),
    details: resolveDescription(input),
  });
  if (range) {
    params.set("dates", `${toGoogleDate(range.start)}/${toGoogleDate(range.end)}`);
  }
  if (input.meeting_url) {
    params.set("location", input.meeting_url);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * https://outlook.live.com/calendar/0/deeplink/compose?...
 *
 * Outlook accepts the same query shape on both consumer (outlook.live.com) and
 * Microsoft 365 (outlook.office.com) deeplinks. We use outlook.office.com as the
 * default since it redirects consumer accounts back to the personal flow.
 */
export function generateOutlookCalendarUrl(input: CalendarMeetingInput): string {
  const range = resolveTimeRange(input);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: resolveTitle(input),
    body: resolveDescription(input),
  });
  if (range) {
    params.set("startdt", range.start.toISOString());
    params.set("enddt", range.end.toISOString());
  }
  if (input.meeting_url) {
    params.set("location", input.meeting_url);
  }
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
