/**
 * scripts/reclassify-onboarding.ts
 *
 * INTERCONNECT_OPERATOR_EMAILS の env を後追加した時、過去の MT は
 * meeting_kind が 'sales' / 'unknown' のまま残ってしまう。
 * 運営参加 MT を全て onboarding に backfill 移行する 1回限りの管理スクリプト。
 *
 * 使い方:
 *   npx tsx scripts/reclassify-onboarding.ts --dry-run
 *   npx tsx scripts/reclassify-onboarding.ts
 *
 * env 必須: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *           INTERCONNECT_OPERATOR_EMAILS
 *
 * 動作:
 *   1. operator email を participant に持つ全 transcripts を抽出
 *   2. meeting_kind != 'onboarding' のものを 'onboarding' に UPDATE
 *   3. status も 'onboarding' に揃える (AI 解析対象から確実に除外)
 *   4. 既存の analyze ジョブが queue に残っていれば cancel
 *   5. 既存 transcript_insights / member_ai_profiles が運営発話で誤生成
 *      されている可能性があるが、本スクリプトは UPDATE のみ。
 *      派生データの purge はユーザー個別に手動 (admin) で実行。
 */
import { createClient } from "@supabase/supabase-js";

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  return { dryRun: args.includes("--dry-run") };
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function main() {
  const args = parseArgs();
  const supabase = createClient(
    envOrThrow("NEXT_PUBLIC_SUPABASE_URL"),
    envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const operators = (process.env.INTERCONNECT_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (operators.length === 0) {
    console.error("INTERCONNECT_OPERATOR_EMAILS が空です。env を設定してください。");
    process.exit(1);
  }

  console.log(`[reclassify] operator emails: ${operators.join(", ")}`);

  // operator が participants に居る transcript_id 一覧を取得
  const { data: rows, error } = await supabase
    .from("meeting_participants")
    .select("transcript_id, email, transcript:meeting_transcripts!inner(id, meeting_kind, status, title)")
    .in("email", operators);

  if (error) {
    console.error("[reclassify] fetch error:", error);
    process.exit(1);
  }

  const targets = new Map<
    string,
    { id: string; meeting_kind: string; status: string; title: string }
  >();
  for (const raw of rows ?? []) {
    const r = raw as unknown as {
      transcript_id: string;
      transcript:
        | { id: string; meeting_kind: string; status: string; title: string }
        | { id: string; meeting_kind: string; status: string; title: string }[]
        | null;
    };
    if (!r.transcript_id || !r.transcript) continue;
    // Supabase joinの戻りはバージョンにより配列 or オブジェクト → 両対応
    const t = Array.isArray(r.transcript) ? r.transcript[0] : r.transcript;
    if (!t) continue;
    if (t.meeting_kind === "onboarding") continue; // skip 適用済
    targets.set(r.transcript_id, t);
  }

  console.log(`[reclassify] targets: ${targets.size} transcripts`);
  if (targets.size === 0) {
    console.log("[reclassify] 対象なし。終了。");
    return;
  }

  if (args.dryRun) {
    console.log("[reclassify][dry-run] would update:");
    for (const [id, t] of targets) {
      console.log(`  - ${id} kind=${t.meeting_kind} status=${t.status} title="${t.title}"`);
    }
    console.log(`[reclassify][dry-run] total: ${targets.size}`);
    return;
  }

  const ids = [...targets.keys()];
  const { error: updErr } = await supabase
    .from("meeting_transcripts")
    .update({
      meeting_kind: "onboarding",
      status: "onboarding",
      classification_reason: "retroactive backfill (operator email match)",
    })
    .in("id", ids);

  if (updErr) {
    console.error("[reclassify] update error:", updErr);
    process.exit(1);
  }

  // queue 中の analyze ジョブを cancel
  const { error: jobErr } = await supabase
    .from("job_queue")
    .delete()
    .eq("type", "analyze")
    .in("status", ["pending", "running"])
    .filter("payload->>transcript_id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);

  if (jobErr) {
    console.warn("[reclassify] job cancel warning (non-fatal):", jobErr);
  }

  console.log(`[reclassify] reclassified ${targets.size} transcripts to 'onboarding'`);
  console.log("[reclassify] 派生データ (transcript_insights / matching_scores) は");
  console.log("[reclassify] 必要に応じて admin が手動で purge してください。");
}

main().catch((e) => {
  console.error("[reclassify] fatal:", e);
  process.exit(1);
});
