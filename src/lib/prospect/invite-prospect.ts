/**
 * Prospect招待の共通実装。
 *
 * 利用元:
 *   - scripts/bulk-invite-prospects.ts (過去のtl;dvデータを遡って一括招待)
 *   - src/app/api/v1/transcripts/webhook/route.ts (tl;dv TranscriptReady 即時処理)
 *
 * 動作:
 *   1. 既存ユーザーチェック (email一致 → skipped_existing)
 *   2. supabase.auth.admin.inviteUserByEmail で招待メール送信
 *   3. user_profiles.prospect_invite_at + expires_at(14日) を backfill
 *   4. meeting_participants.user_id を backfill
 *   5. bulk_invite_log に invite metadata 記録
 *   6. 失敗時は auth.admin.deleteUser で rollback (ghost auth user 防止)
 *
 * transcript_status='pending_consent' のため、招待メール → consent → /api/v1/legal/accept
 * → promote_pending_consent_for_user RPC が ready 昇格 + analyze ジョブ enqueue する。
 * 同意ゲート通過まで Claude には送信されない設計。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProspectCandidate {
  /** lowercased email */
  email: string;
  /** speaker_name 等から取得した表示名 */
  name: string;
  /** 紐付ける meeting_transcripts.id 一覧(invite側でmetadataに保存するため) */
  meetingIds: string[];
  /** 紐付ける meeting_participants.id 一覧(招待後にuser_id back-fill対象) */
  participantIds: string[];
}

export type InviteStatus =
  | "invited"
  | "skipped_existing"
  | "skipped_dry_run"
  | "failed";

export interface InviteResult {
  email: string;
  status: InviteStatus;
  userId?: string;
  error?: string;
}

export interface InviteOptions {
  /** 招待主のauth.users.id (audit用)。webhook起動時はホスト=meeting organizer のID */
  invitedBy?: string | null;
  /** dry-run: 何もせず candidate 返却のみ */
  dryRun?: boolean;
  /** 招待リンクの追加メタデータ (bulk_invite_log.metadata に保存) */
  metadata?: Record<string, unknown>;
  /** 14日以外の expires (ms単位) */
  expiresMs?: number;
}

const DEFAULT_EXPIRES_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * 1人のprospectを招待する。冪等性: 既存ユーザーは skipped_existing。
 * partial failure 時は auth.admin.deleteUser でロールバックし zombie防止。
 */
export async function inviteProspect(
  supabase: SupabaseClient,
  candidate: ProspectCandidate,
  options: InviteOptions = {},
): Promise<InviteResult> {
  if (options.dryRun) {
    return { email: candidate.email, status: "skipped_dry_run" };
  }

  // 既存ユーザーチェック (email一致)
  const { data: existing } = await supabase
    .from("user_profiles")
    .select("id")
    .ilike("email", candidate.email)
    .maybeSingle();
  if (existing) {
    return {
      email: candidate.email,
      status: "skipped_existing",
      userId: (existing as { id: string }).id,
    };
  }

  // Supabase Auth Admin: invite
  const { data: invited, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(candidate.email, {
      data: {
        name: candidate.name,
        prospect_invite: true,
        source_meeting_count: candidate.meetingIds.length,
      },
    });

  if (inviteError || !invited?.user) {
    return {
      email: candidate.email,
      status: "failed",
      error: inviteError?.message ?? "no user returned",
    };
  }

  const userId = invited.user.id;
  const inviteSentAt = new Date();
  const expiresAt = new Date(inviteSentAt.getTime() + (options.expiresMs ?? DEFAULT_EXPIRES_MS));

  try {
    const { error: profileErr } = await supabase.from("user_profiles").upsert(
      {
        id: userId,
        email: candidate.email,
        name: candidate.name,
        prospect_invite_at: inviteSentAt.toISOString(),
        prospect_invite_expires_at: expiresAt.toISOString(),
      },
      { onConflict: "id" },
    );
    if (profileErr) throw new Error(`profiles upsert: ${profileErr.message}`);

    const { error: pErr } = await supabase
      .from("meeting_participants")
      .update({
        user_id: userId,
        is_linked: true,
        linked_method: "email",
      })
      .in("id", candidate.participantIds);
    if (pErr) throw new Error(`participants update: ${pErr.message}`);

    const { error: logErr } = await supabase.from("bulk_invite_log").insert({
      invited_by: options.invitedBy ?? null,
      email: candidate.email,
      user_id: userId,
      source_meeting_ids: candidate.meetingIds,
      status: "invited",
      metadata: {
        invite_sent_at: inviteSentAt.toISOString(),
        invite_expires_at: expiresAt.toISOString(),
        participant_count: candidate.participantIds.length,
        meeting_count: candidate.meetingIds.length,
        ...(options.metadata ?? {}),
      },
    });
    if (logErr) throw new Error(`bulk_invite_log insert: ${logErr.message}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[invite-prospect] DB write failed for ${candidate.email}, rolling back auth user`,
      msg,
    );
    try {
      await supabase.auth.admin.deleteUser(userId);
    } catch (rollbackErr) {
      console.error(
        `[invite-prospect] rollback failed for user ${userId}`,
        rollbackErr,
      );
    }
    return { email: candidate.email, status: "failed", error: msg };
  }

  return { email: candidate.email, status: "invited", userId };
}

/**
 * transcript_id に紐づく未紐付 participants から prospect candidate を抽出。
 * webhook フローで「このミーティングだけのprospects」を auto-invite するために使う。
 */
export async function extractProspectsForTranscript(
  supabase: SupabaseClient,
  transcriptId: string,
): Promise<ProspectCandidate[]> {
  const { data, error } = await supabase
    .from("meeting_participants")
    .select("id, transcript_id, email, speaker_name, is_linked")
    .eq("transcript_id", transcriptId)
    .eq("is_linked", false)
    .not("email", "is", null);

  if (error) {
    throw new Error(`extractProspectsForTranscript: ${error.message}`);
  }

  const map = new Map<string, ProspectCandidate>();
  for (const p of data ?? []) {
    const email = ((p.email as string) ?? "").toLowerCase().trim();
    if (!email.includes("@")) continue;
    if (!map.has(email)) {
      map.set(email, {
        email,
        name: (p.speaker_name as string) ?? email,
        meetingIds: [transcriptId],
        participantIds: [],
      });
    }
    map.get(email)!.participantIds.push(p.id as string);
  }
  return [...map.values()];
}

/**
 * webhook 内で呼ぶ「単一transcriptに対する全prospect自動招待」エントリ。
 * 各prospectをsequentialに rate-limit付きで招待し、結果を集約する。
 */
export async function autoInviteProspectsForTranscript(
  supabase: SupabaseClient,
  transcriptId: string,
  invitedBy: string | null,
  perInviteDelayMs = 6000,
): Promise<{
  prospects: number;
  invited: number;
  skipped: number;
  failed: number;
  details: InviteResult[];
}> {
  const candidates = await extractProspectsForTranscript(supabase, transcriptId);
  const details: InviteResult[] = [];
  let invited = 0;
  let skipped = 0;
  let failed = 0;

  for (const cand of candidates) {
    const r = await inviteProspect(supabase, cand, {
      invitedBy,
      metadata: { source: "webhook_auto_invite", transcript_id: transcriptId },
    });
    details.push(r);
    if (r.status === "invited") invited++;
    else if (r.status === "skipped_existing" || r.status === "skipped_dry_run") skipped++;
    else if (r.status === "failed") failed++;

    if (perInviteDelayMs > 0 && cand !== candidates[candidates.length - 1]) {
      await new Promise((res) => setTimeout(res, perInviteDelayMs));
    }
  }

  return {
    prospects: candidates.length,
    invited,
    skipped,
    failed,
    details,
  };
}
