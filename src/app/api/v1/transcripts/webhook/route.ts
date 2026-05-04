import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { createTldvClient, processTldvMeeting } from "@/lib/tldv";
import { autoInviteProspectsForTranscript } from "@/lib/prospect/invite-prospect";

/**
 * tl;dv TranscriptReady webhook エントリ。
 *
 * 動作:
 *   1. webhook secret 検証
 *   2. processTldvMeeting(holdForConsent=true) で transcript保存
 *      → status='pending_consent' のため Claude には未送信
 *   3. autoInviteProspectsForTranscript で prospect 自動招待
 *      → host(linked user) の同意は不要 (signup時に取得済)
 *      → prospect は招待メール → /onboarding/consent → 同意完了
 *      → /api/v1/legal/accept が promote_pending_consent_for_user を呼び
 *        transcript を ready 昇格 + analyze ジョブ enqueue
 *   4. 全 prospect が拒否 or 期限切れの場合は cleanup_expired_prospects(日次cron)
 *      で 14日後に自動削除 + REDACT
 *
 * 結果として「商談終了 → 自動 prospect 招待 → 同意取得 → AI分析開始」の
 * 完全自動化フローが webhook 1本で完結する。
 */
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

    const meetingId =
      body.data?.meetingId ?? body.data?.meeting?.id ?? body.data?.id;
    if (!meetingId || typeof meetingId !== "string") {
      return jsonError(400, "BAD_REQUEST", "Missing meeting ID in payload");
    }

    const supabase = await createServiceClient();
    const tldv = createTldvClient();

    // Step 1: meeting処理 (holdForConsent=true で同意前 Claude送信を阻止)
    const result = await processTldvMeeting(meetingId, supabase, tldv, {
      holdForConsent: true,
    });

    // Step 2: 既処理スキップ時は invite を実行しない (再 webhook 二重招待防止)
    if (result.skipped) {
      return json({
        processed: false,
        skipped: true,
        transcriptId: result.transcriptId,
        message: "transcript already processed",
      });
    }

    // Step 3: host (organizer 一致 user_profile) を invitedBy として記録
    let invitedBy: string | null = null;
    try {
      const meeting = await tldv.getMeeting(meetingId);
      if (meeting.organizer?.email) {
        const { data: hostProfile } = await supabase
          .from("user_profiles")
          .select("id")
          .ilike("email", meeting.organizer.email)
          .maybeSingle();
        invitedBy = (hostProfile as { id: string } | null)?.id ?? null;
      }
    } catch (e) {
      console.warn("[webhook] failed to resolve host invitedBy", e);
    }

    // Step 4: prospect 自動招待 (rate-limit 6s/通)
    let inviteSummary;
    try {
      inviteSummary = await autoInviteProspectsForTranscript(
        supabase,
        result.transcriptId,
        invitedBy,
        6000,
      );
    } catch (e) {
      console.error("[webhook] autoInviteProspectsForTranscript failed", e);
      // invite失敗 ≠ webhook失敗。transcript保存は完了しているので 200 を返し、
      // 別途 cron や retry で fallback できるようにする
      return json({
        processed: true,
        transcriptId: result.transcriptId,
        participants: result.participantIds.length,
        invite_error: e instanceof Error ? e.message : String(e),
      });
    }

    return json({
      processed: true,
      transcriptId: result.transcriptId,
      participants: result.participantIds.length,
      auto_invite: inviteSummary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
