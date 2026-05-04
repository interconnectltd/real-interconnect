/**
 * scripts/bulk-invite-prospects.ts
 *
 * 商談相手 (prospect) を tl;dv トランスクリプトから抽出し、
 * Supabase Auth Admin API で一括招待するCLIスクリプト。
 *
 * 動作フロー:
 *   1. tl;dv API から meetings + transcripts を取得 (--max-meetings で件数制限)
 *   2. processTldvMeeting(holdForConsent=true) で meeting_transcripts/meeting_participants を作成
 *      → status='pending_consent' で保留 (Claude送信なし、同意取得後に昇格)
 *   3. participants から email 重複排除し prospect 候補を抽出
 *   4. invite_user_by_email で招待 (我々の100点branded日本語inviteメール送信)
 *   5. user_profiles.prospect_invite_at と meeting_participants.user_id を back-fill
 *   6. bulk_invite_log に記録
 *
 * 使い方:
 *   npx tsx scripts/bulk-invite-prospects.ts --dry-run       (対象一覧のみ表示)
 *   npx tsx scripts/bulk-invite-prospects.ts --max-meetings=20
 *   npx tsx scripts/bulk-invite-prospects.ts --emails=a@x.co,b@y.co  (特定相手のみ)
 *
 * 必要な env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TLDV_API_KEY
 *
 * ⚠️ 法務上の前提: 過去の商談時にミーティング相手から「INTER CONNECTサービスでAI分析する」旨の
 *    告知 + 録音同意を取得済であること (規約第12条のユーザー側責任)。
 *    告知していない場合、招待メール本文で明示通知 + 拒否時の即時データ削除導線で運用する。
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { TldvClient } from "../src/lib/tldv/client";
import { processTldvMeeting } from "../src/lib/tldv/process-meeting";
import { inviteProspect, type InviteResult, type ProspectCandidate } from "../src/lib/prospect/invite-prospect";

interface CliArgs {
  dryRun: boolean;
  maxMeetings: number;
  emails: string[] | null;
  invitedBy: string | null;
}

// ProspectCandidate / InviteResult は src/lib/prospect/invite-prospect.ts から import

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (key: string) => {
    const arg = args.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : null;
  };
  return {
    dryRun: args.includes("--dry-run"),
    maxMeetings: Number(get("max-meetings") ?? "10"),
    emails: get("emails")
      ? get("emails")!
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      : null,
    invitedBy: get("invited-by"),
  };
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function syncMeetings(
  supabase: SupabaseClient,
  tldv: TldvClient,
  maxMeetings: number,
  dryRun: boolean,
): Promise<{ processed: number; skipped: number; errors: string[] }> {
  console.log(`[sync] fetching up to ${maxMeetings} meetings from tl;dv...`);
  if (dryRun) {
    // dry-run: tl;dv listのみ実行し、 DB書き込みは行わない
    const list = await tldv.listMeetings(1);
    const meetings = list.results.slice(0, maxMeetings);
    console.log(`[sync][dry-run] would process ${meetings.length} meetings:`);
    for (const m of meetings) {
      const inviteEmails = (m.invitees ?? [])
        .map((i) => i.email)
        .filter((e): e is string => Boolean(e));
      console.log(`  - ${m.id} ${m.name} (${m.happenedAt}, invitees: ${inviteEmails.length})`);
    }
    return { processed: 0, skipped: meetings.length, errors: [] };
  }
  const list = await tldv.listMeetings(1);
  const meetings = list.results.slice(0, maxMeetings);
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const m of meetings) {
    try {
      const result = await processTldvMeeting(m.id, supabase, tldv, {
        holdForConsent: true,
      });
      if (result.skipped) skipped++;
      else processed++;
      console.log(
        `[sync] ${result.skipped ? "skip" : "proc"} ${m.id} (${m.name})`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${m.id}: ${msg}`);
      console.error(`[sync] FAIL ${m.id}: ${msg}`);
    }
  }
  return { processed, skipped, errors };
}

async function extractProspects(
  supabase: SupabaseClient,
  filterEmails: string[] | null,
): Promise<ProspectCandidate[]> {
  // is_linked=false かつ email が存在する participants → 招待候補
  const { data, error } = await supabase
    .from("meeting_participants")
    .select("id, transcript_id, email, speaker_name, is_linked")
    .eq("is_linked", false)
    .not("email", "is", null);

  if (error) throw new Error(`Failed to fetch prospects: ${error.message}`);

  const map = new Map<string, ProspectCandidate>();
  for (const p of data ?? []) {
    const email = (p.email as string).toLowerCase().trim();
    if (filterEmails && !filterEmails.includes(email)) continue;
    if (!email.includes("@")) continue;
    if (!map.has(email)) {
      map.set(email, {
        email,
        name: p.speaker_name as string,
        meetingIds: [],
        participantIds: [],
      });
    }
    const c = map.get(email)!;
    if (p.transcript_id && !c.meetingIds.includes(p.transcript_id as string)) {
      c.meetingIds.push(p.transcript_id as string);
    }
    c.participantIds.push(p.id as string);
  }
  return [...map.values()];
}

// inviteOne は src/lib/prospect/invite-prospect.ts の inviteProspect() に統合済み
async function inviteOne(
  supabase: SupabaseClient,
  candidate: ProspectCandidate,
  invitedBy: string | null,
  dryRun: boolean,
): Promise<InviteResult> {
  return inviteProspect(supabase, candidate, {
    invitedBy,
    dryRun,
    metadata: { source: "bulk_invite_cli" },
  });
}

async function main() {
  const args = parseArgs();
  console.log(`[bulk-invite] args:`, args);

  const supabase = createClient(
    envOrThrow("NEXT_PUBLIC_SUPABASE_URL"),
    envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const tldv = new TldvClient(envOrThrow("TLDV_API_KEY"));

  // Step 1: tl;dv meetings 同期 (holdForConsent=true で保留)。 dry-run は DB書き込みなし。
  const syncResult = await syncMeetings(supabase, tldv, args.maxMeetings, args.dryRun);
  console.log(`[sync] processed=${syncResult.processed} skipped=${syncResult.skipped} errors=${syncResult.errors.length}`);

  // Step 2: prospect 抽出
  const prospects = await extractProspects(supabase, args.emails);
  console.log(`[extract] ${prospects.length} unique prospects with email`);
  if (prospects.length === 0) {
    console.log("[extract] No prospects to invite. Exiting.");
    return;
  }

  for (const p of prospects.slice(0, 5)) {
    console.log(`  - ${p.email} (${p.name}, ${p.meetingIds.length} meetings)`);
  }
  if (prospects.length > 5) {
    console.log(`  ... and ${prospects.length - 5} more`);
  }

  if (args.dryRun) {
    console.log(`\n[dry-run] would invite ${prospects.length} prospects. exit.`);
    return;
  }

  // Step 3: invite
  console.log(`\n[invite] sending invites... (rate limit: 6s/通 with exponential backoff on 429)`);
  const results: InviteResult[] = [];
  for (const p of prospects) {
    let attempt = 0;
    let waitMs = 6000; // base
    let r: InviteResult | null = null;
    while (attempt < 4 && r === null) {
      const candidate = await inviteOne(supabase, p, args.invitedBy, args.dryRun);
      // 429 detection (Supabaseはエラーmessageに含む)
      if (
        candidate.status === "failed" &&
        candidate.error &&
        /rate.?limit|429|too many/i.test(candidate.error)
      ) {
        attempt++;
        waitMs *= 2; // exponential backoff
        console.warn(
          `  [retry ${attempt}/4] ${candidate.email} rate-limited, waiting ${waitMs}ms`,
        );
        await new Promise((res) => setTimeout(res, waitMs));
        continue;
      }
      r = candidate;
    }
    if (!r) {
      r = { email: p.email, status: "failed", error: "max_retries_exhausted" };
    }
    results.push(r);
    console.log(`  [${r.status}] ${r.email}${r.error ? ` (${r.error})` : ""}`);
    await new Promise((res) => setTimeout(res, 6000)); // 通常スロットリング 6秒/通
  }

  // Summary
  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log(`\n[summary]`, summary);
}

main().catch((e) => {
  console.error("[bulk-invite] fatal:", e);
  process.exit(1);
});
