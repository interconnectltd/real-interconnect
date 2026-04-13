import type { SupabaseClient } from "@supabase/supabase-js";
import type { TldvClient } from "./client";
import { linkSpeakerToUser } from "./link-speaker";

interface ProcessResult {
  transcriptId: string;
  participantIds: string[];
  skipped: boolean;
}

export async function processTldvMeeting(
  meetingId: string,
  supabase: SupabaseClient,
  tldv: TldvClient,
): Promise<ProcessResult> {
  // 冪等性チェック: 既に処理済みなら skip
  const { data: existing } = await supabase
    .from("meeting_transcripts")
    .select("id, status")
    .eq("tldv_meeting_id", meetingId)
    .maybeSingle();

  if (existing && existing.status !== "error") {
    return { transcriptId: existing.id, participantIds: [], skipped: true };
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

  // meeting_transcripts に UPSERT
  const transcriptRow = {
    tldv_meeting_id: meetingId,
    title: meeting.name,
    meeting_date: meeting.happenedAt,
    full_text: fullText,
    status: "ready" as const,
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

    // ユーザー紐付け
    const link = await linkSpeakerToUser(speaker, email, supabase);

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

    // 紐付け成功した参加者に analyze ジョブを投入
    if (link.isLinked) {
      await enqueueAnalyzeJob(supabase, transcriptId, participant.id);
    }
  }

  return { transcriptId, participantIds, skipped: false };
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
