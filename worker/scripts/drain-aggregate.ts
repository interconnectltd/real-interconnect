/**
 * aggregate ジョブを GitHub Actions で消化する drain worker。
 * analyze 完了 → aggregate で transcript_insights を user_conversation_vectors に集約。
 *
 * 実行: pnpm exec tsx worker/scripts/drain-aggregate.ts
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   AGGREGATE_MAX_JOBS            default 100
 */

import "dotenv/config";

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !srk) throw new Error("Missing Supabase env");
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = srk;

  const maxJobs = Math.max(1, Math.min(Number(process.env.AGGREGATE_MAX_JOBS ?? 100), 500));

  const { claimJobDirect, completeJob, failJob } = await import("../src/queue");
  const { handleAggregate } = await import("../src/handlers/aggregate");

  const workerId = `gh-actions-aggregate-${process.env.GITHUB_RUN_ID ?? Date.now()}`;
  console.log(`[drain-aggregate] worker=${workerId} maxJobs=${maxJobs}`);

  let ok = 0;
  let fail = 0;
  let dead = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimJobDirect(workerId);
    if (!job) {
      console.log(`[drain-aggregate] no more pending jobs at ${i}`);
      break;
    }
    if (job.type !== "aggregate") {
      await failJob(job.id, "non-aggregate type, returned to queue", job.attempts - 1, job.max_attempts);
      continue;
    }

    try {
      await handleAggregate(job.payload as { user_id: string });
      await completeJob(job.id);
      ok++;
      console.log(`[drain-aggregate] ok ${job.id.slice(0, 8)} (${ok} done)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDead = job.attempts >= job.max_attempts;
      await failJob(job.id, msg, job.attempts, job.max_attempts);
      if (isDead) dead++;
      else fail++;
      console.error(`[drain-aggregate] ${isDead ? "DEAD" : "fail"} ${job.id.slice(0, 8)}: ${msg.slice(0, 120)}`);
    }
  }

  console.log(`[drain-aggregate] done ok=${ok} fail=${fail} dead=${dead}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
