import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { createTldvClient, processTldvMeeting } from "@/lib/tldv";

export async function POST(request: Request) {
  try {
    await withAuth();

    const { searchParams } = new URL(request.url);
    const maxMeetings = Math.min(Number(searchParams.get("limit") ?? "3"), 10);

    const supabase = await createServiceClient();
    const tldv = createTldvClient();

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // 1ページ目のみ取得し、最大 maxMeetings 件を処理（タイムアウト回避）
    const list = await tldv.listMeetings(1);

    const meetings = list.results.slice(0, maxMeetings);
    for (const meeting of meetings) {
      try {
        // holdForConsent=true: 同意未取得のprospect発話が混入する transcript を
        // Claude送信前に一時保留にする (越境移転同意の時系列保証)
        const result = await processTldvMeeting(meeting.id, supabase, tldv, {
          holdForConsent: true,
        });
        if (result.skipped) {
          skipped++;
        } else {
          processed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${meeting.id}: ${msg}`);
      }
    }

    return json({
      processed,
      skipped,
      errors: errors.length,
      errorDetails: errors.slice(0, 5),
      total: list.total,
      hasMore: list.total > maxMeetings,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
