import type { SupabaseClient } from "@supabase/supabase-js";
import type { TldvClient } from "./client";
import { linkSpeakerToUser } from "./link-speaker";
import {
  classifyMeeting,
  readInternalDomainsFromEnv,
  readOperatorEmailsFromEnv,
  type MeetingKind,
  type MeetingClassificationResult,
} from "./classify-meeting";

interface ProcessResult {
  transcriptId: string;
  participantIds: string[];
  skipped: boolean;
  classification: MeetingClassificationResult;
  /** internal と判定されて prospect 招待をスキップする場合 true */
  skipInvite: boolean;
}

/**
 * tl;dvミーティングを取り込み、参加者ごとに meeting_participants を作成する。
 *
 * @param meetingId    tl;dv meeting ID
 * @param supabase     service-role client
 * @param tldv         TldvClient
 * @param options.holdForConsent  trueの場合、参加者を analyze enqueue せず
 *                                meeting_transcripts.status='pending_consent' で保留する。
 *                                bulk-invite フローで「招待 → 同意 → 分析」順序を保証するため。
 */
export async function processTldvMeeting(
  meetingId: string,
  supabase: SupabaseClient,
  tldv: TldvClient,
  options: {
    holdForConsent?: boolean;
    internalDomains?: string[];
    /** 運営オペレーター email (CSV)。指定されていれば onboarding 判定に使用 */
    operatorEmails?: string[];
    /**
     * true なら internal / onboarding 判定時に **DB 書込もせずに完全スキップ**する。
     * 通常 (false) は記録のために DB upsert するが、AI 解析だけスキップする (admin で override 可能)。
     */
    skipIfInternal?: boolean;
  } = {},
): Promise<ProcessResult> {
  // 冪等性チェック: 既に処理済みなら skip
  const { data: existing } = await supabase
    .from("meeting_transcripts")
    .select("id, status, meeting_kind, classification_reason")
    .eq("tldv_meeting_id", meetingId)
    .maybeSingle();

  if (existing && existing.status !== "error") {
    const rawKind = (existing as { meeting_kind?: string }).meeting_kind;
    // 文字列リテラル検証で MeetingKind narrowing (DB に未知値が来た場合 unknown フォールバック)
    const existingKind: MeetingKind =
      rawKind === "sales" || rawKind === "internal" || rawKind === "onboarding"
        ? rawKind
        : "unknown";
    return {
      transcriptId: (existing as { id: string }).id,
      participantIds: [],
      skipped: true,
      classification: {
        kind: existingKind,
        confidence: 1, // already classified
        reason:
          (existing as { classification_reason?: string }).classification_reason ??
          "previously classified",
        externalDomains: [],
        internalDomainsMatched: [],
      },
      // onboarding も招待・解析を skip (運営との面談で発火しない)
      skipInvite: existingKind === "internal" || existingKind === "onboarding",
    };
  }

  // tl;dv API からミーティング詳細 + 書き起こし取得
  const [meeting, transcript] = await Promise.all([
    tldv.getMeeting(meetingId),
    tldv.getTranscript(meetingId),
  ]);

  const segments = transcript.data ?? [];

  // full_text を組み立て
  const fullText = segments
    .map((s) => `[${s.speaker}]: ${s.text}`)
    .join("\n");

  // 発話者ごとの speaking_ratio を計算
  const speakerDurations = new Map<string, number>();
  let totalDuration = 0;
  for (const seg of segments) {
    const dur = seg.endTime - seg.startTime;
    speakerDurations.set(
      seg.speaker,
      (speakerDurations.get(seg.speaker) ?? 0) + dur,
    );
    totalDuration += dur;
  }

  // 商談 vs 社内 vs 運営面談 の分類 (招待ループ前にDBに記録、admin が後で override 可能)
  const inviteeEmails = (meeting.invitees ?? []).map((i) => i.email);
  const speakerNames = [...new Set(segments.map((s) => s.speaker))];
  const internalDomains = options.internalDomains ?? readInternalDomainsFromEnv();
  const operatorEmails = options.operatorEmails ?? readOperatorEmailsFromEnv();

  // env で独自の internal パターン CSV を渡せる (例: "meet インターコネクト,team sync,定例")
  const extraInternalPatterns = (process.env.TLDV_EXTRA_INTERNAL_PATTERNS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new RegExp(s, "i"));

  const classification = classifyMeeting(
    {
      title: meeting.name,
      organizerEmail: meeting.organizer?.email,
      participantEmails: inviteeEmails,
      speakerNames,
      fullText,
    },
    {
      internalDomains,
      operatorEmails,
      extraTitleExcludePatterns: extraInternalPatterns.length ? extraInternalPatterns : undefined,
    },
  );

  // internal / onboarding は招待 + AI 解析を共に skip
  // (onboarding は運営との面談、ユーザー嗜好が誤推定されないよう解析対象外)
  const skipInvite =
    classification.kind === "internal" || classification.kind === "onboarding";

  // skipIfInternal=true: 取り込みから完全に除外 (DB 書込もしない)
  if (options.skipIfInternal && skipInvite) {
    return {
      transcriptId: "",
      participantIds: [],
      skipped: true,
      classification,
      skipInvite: true,
    };
  }
  const computedStatus: "ready" | "pending_consent" | "internal" | "onboarding" =
    classification.kind === "onboarding"
      ? "onboarding"
      : classification.kind === "internal"
      ? "internal"
      : options.holdForConsent
      ? "pending_consent"
      : "ready";

  // meeting_transcripts に UPSERT
  const transcriptRow = {
    tldv_meeting_id: meetingId,
    title: meeting.name,
    meeting_date: meeting.happenedAt,
    full_text: fullText,
    status: computedStatus,
    meeting_kind: classification.kind,
    classification_reason: classification.reason,
    fetched_at: new Date().toISOString(),
  };

  let transcriptId: string;
  if (existing) {
    // error 状態の既存レコードを更新
    const { data, error } = await supabase
      .from("meeting_transcripts")
      .update({ ...transcriptRow, error_message: null })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    transcriptId = data.id;
  } else {
    const { data, error } = await supabase
      .from("meeting_transcripts")
      .insert(transcriptRow)
      .select("id")
      .single();
    if (error) throw error;
    transcriptId = data.id;
  }

  // invitees + organizer から名前→email のマップを作成
  const emailMap = new Map<string, string>();
  if (meeting.organizer?.email) {
    emailMap.set(meeting.organizer.name?.toLowerCase() ?? "", meeting.organizer.email);
  }
  for (const inv of meeting.invitees ?? []) {
    if (inv.email) {
      emailMap.set(inv.name?.toLowerCase() ?? "", inv.email);
    }
  }

  // 発話者ごとに participant を作成
  const participantIds: string[] = [];
  const speakers = [...speakerDurations.keys()];

  for (const speaker of speakers) {
    const ratio = totalDuration > 0
      ? (speakerDurations.get(speaker) ?? 0) / totalDuration
      : 0;

    // invitees から email を推定
    const email = emailMap.get(speaker.toLowerCase()) ?? null;

    // ユーザー紐付け (holdForConsent=true なら strict mode で name_partial 抑制)
    const link = await linkSpeakerToUser(speaker, email, supabase, {
      strict: options.holdForConsent === true,
    });

    const { data: participant, error } = await supabase
      .from("meeting_participants")
      .insert({
        transcript_id: transcriptId,
        user_id: link.userId,
        speaker_name: speaker,
        email,
        speaking_ratio: Math.round(ratio * 100) / 100,
        is_linked: link.isLinked,
        linked_method: link.linkedMethod,
      })
      .select("id")
      .single();

    if (error) throw error;
    participantIds.push(participant.id);

    // 紐付け成功 + 同意保留中でない + 内部会議でない場合のみ analyze ジョブ投入。
    // holdForConsent モードでは promote_pending_consent_for_user が同意完了時に enqueue する。
    // skipInvite (=internal) の場合はそもそも AI 解析対象外なので enqueue しない。
    if (link.isLinked && !options.holdForConsent && !skipInvite) {
      await enqueueAnalyzeJob(supabase, transcriptId, participant.id);
    }
  }

  return { transcriptId, participantIds, skipped: false, classification, skipInvite };
}

async function enqueueAnalyzeJob(
  supabase: SupabaseClient,
  transcriptId: string,
  participantId: string,
) {
  const payload = { transcript_id: transcriptId, participant_id: participantId };

  // 重複チェック
  const { data: existing } = await supabase
    .from("job_queue")
    .select("id")
    .eq("type", "analyze")
    .contains("payload", payload)
    .in("status", ["pending", "running"])
    .maybeSingle();

  if (existing) return;

  const { error } = await supabase.from("job_queue").insert({
    type: "analyze",
    payload,
    status: "pending",
    priority: 10,
    attempts: 0,
    max_attempts: 3,
  });

  if (error) {
    console.error("Failed to enqueue analyze job:", error.message);
  }
}
