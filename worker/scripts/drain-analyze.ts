/**
 * analyze ジョブを GitHub Actions で消化する drain worker。
 * R4 audit 提案: tldv-sync で 50+ 件取り込んだ後、user_conversation_vectors を
 * 更新するためには analyze → aggregate のパイプラインが必要。
 *
 * 実行:
 *   pnpm exec tsx worker/scripts/drain-analyze.ts
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY (or AI_API_KEY)
 *   ANALYZE_MAX_JOBS              一度の実行で消化する上限 (default 60)
 *   ANALYZE_DAILY_USD_CAP         予算上限 USD (default 30)、Opus 4.6 = $0.40/件想定
 */

import "dotenv/config";

async function main() {
  // env trim (tldv で実証済の防御コード)
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const ak = (process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY ?? "").trim();
  if (!url || !srk) throw new Error("Missing Supabase env");
  if (!ak) throw new Error("Missing ANTHROPIC_API_KEY / AI_API_KEY");
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = srk;
  process.env.ANTHROPIC_API_KEY = ak;
  process.env.AI_API_KEY = ak;

  const maxJobs = Math.max(1, Math.min(Number(process.env.ANALYZE_MAX_JOBS ?? 60), 200));
  const usdCap = Math.max(1, Number(process.env.ANALYZE_DAILY_USD_CAP ?? 30));
  const usdPerJob = 0.4; // Opus 4.6 1 transcript の概算

  // 動的 import (env セット後)
  const { claimJobDirect, completeJob, failJob } = await import("../src/queue");
  const { handleAnalyze } = await import("../src/handlers/analyze");

  const workerId = `gh-actions-${process.env.GITHUB_RUN_ID ?? Date.now()}`;
  console.log(`[drain-analyze] worker=${workerId} maxJobs=${maxJobs} usdCap=$${usdCap}`);

  let ok = 0;
  let fail = 0;
  let dead = 0;
  let usd = 0;
  for (let i = 0; i < maxJobs; i++) {
    if (usd >= usdCap) {
      console.warn(`[drain-analyze] USD cap $${usdCap} hit at job ${i}, stopping (used $${usd.toFixed(2)})`);
      break;
    }
    const job = await claimJobDirect(workerId);
    if (!job) {
      console.log(`[drain-analyze] no more pending analyze jobs at ${i}`);
      break;
    }
    if (job.type !== "analyze") {
      // 他 type は触らずに pending に戻す (locked_at をクリア)
      await failJob(job.id, "non-analyze type, returned to queue", job.attempts - 1, job.max_attempts);
      continue;
    }

    try {
      await handleAnalyze(job.payload as { transcript_id: string; participant_id: string });
      await completeJob(job.id);
      ok++;
      usd += usdPerJob;
      console.log(`[drain-analyze] ok ${job.id.slice(0, 8)} (${ok} done, ~$${usd.toFixed(2)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDead = job.attempts >= job.max_attempts;
      await failJob(job.id, msg, job.attempts, job.max_attempts);
      if (isDead) dead++;
      else fail++;
      console.error(`[drain-analyze] ${isDead ? "DEAD" : "fail"} ${job.id.slice(0, 8)}: ${msg.slice(0, 120)}`);
    }
  }

  console.log(`[drain-analyze] done ok=${ok} fail=${fail} dead=${dead} usd=$${usd.toFixed(2)}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
