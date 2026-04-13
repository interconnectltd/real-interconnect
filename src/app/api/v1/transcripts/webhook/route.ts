import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { createTldvClient, processTldvMeeting } from "@/lib/tldv";

export async function POST(request: Request) {
  try {
    // Webhook シークレット検証
    const expectedSecret = process.env.TLDV_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return jsonError(500, "CONFIG_ERROR", "Webhook secret not configured");
    }

    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    if (secret !== expectedSecret) {
      return jsonError(401, "UNAUTHORIZED", "Invalid webhook secret");
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "Invalid request body");
    }

    const event = body.event as string;

    // TranscriptReady のみ処理
    if (event !== "TranscriptReady") {
      return json({ ignored: true, event });
    }

    // tl;dv payload: {id, event, data: {...}, executedAt}
    // data内のmeetingIdまたはid、またはルートレベルのdata.meetingIdを探す
    const meetingId =
      body.data?.meetingId ?? body.data?.meeting?.id ?? body.data?.id;
    if (!meetingId || typeof meetingId !== "string") {
      return jsonError(400, "BAD_REQUEST", "Missing meeting ID in payload");
    }

    const supabase = await createServiceClient();
    const tldv = createTldvClient();

    const result = await processTldvMeeting(meetingId, supabase, tldv);

    return json({
      processed: !result.skipped,
      transcriptId: result.transcriptId,
      participants: result.participantIds.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
