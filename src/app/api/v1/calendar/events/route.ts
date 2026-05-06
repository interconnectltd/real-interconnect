import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** GET /api/v1/calendar/events — カレンダーイベント一覧 */
export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10)),
    );
    const offset = (page - 1) * limit;

    // 日付バリデーション
    if (from && isNaN(Date.parse(from))) {
      return jsonError(400, "BAD_REQUEST", "fromの日付形式が不正です");
    }
    if (to && isNaN(Date.parse(to))) {
      return jsonError(400, "BAD_REQUEST", "toの日付形式が不正です");
    }

    let query = supabase
      .from("calendar_events")
      .select(
        `
        id, external_event_id, title, start_at, end_at,
        video_url, video_platform, attendee_emails,
        is_interconnect, recording_enabled, linked_meeting_id, etag,
        created_at, updated_at,
        meeting:meetings(id, title, status, scheduled_at, platform, meeting_url)
      `,
        { count: "exact" },
      )
      .eq("user_id", user.id)
      .order("start_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) {
      query = query.gte("start_at", from);
    }
    if (to) {
      query = query.lte("start_at", to);
    }

    const { data, error } = await query;

    if (error) throw error;

    const mapped = (data ?? []).map((e: Record<string, unknown>) => ({
      ...e,
      start: e.start_at,
      end: e.end_at,
      platform: e.video_platform,
      attendees: (Array.isArray(e.attendee_emails) ? e.attendee_emails : []).map(
        (email: string) => ({ email, name: null, response_status: null }),
      ),
      duration_min:
        e.start_at && e.end_at
          ? Math.round(
              (new Date(e.end_at as string).getTime() -
                new Date(e.start_at as string).getTime()) /
                60000,
            )
          : null,
    }));

    return json(mapped);
  } catch (error) {
    return handleApiError(error);
  }
}
