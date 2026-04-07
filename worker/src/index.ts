/**
 * INTERCONNECT Worker
 * PostgreSQLジョブキューを5秒間隔でポーリングし、ジョブを実行
 */

import { claimJobDirect, completeJob, failJob, releaseStaleJobs } from "./queue";
import { handleAnalyze } from "./handlers/analyze";
import { handleAggregate } from "./handlers/aggregate";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_INTERVAL = 5000;

async function processJob(): Promise<boolean> {
  const job = await claimJobDirect(WORKER_ID);
  if (!job) return false;

  console.log(`[${WORKER_ID}] Processing job ${job.id} (${job.type})`);

  try {
    switch (job.type) {
      case "analyze":
        await handleAnalyze(job.payload as { transcript_id: string; participant_id: string });
        break;
      case "aggregate":
        await handleAggregate(job.payload as { user_id: string });
        break;
      case "score":
        // compute API を HTTP で呼ぶか、直接 computeScore を呼ぶ
        // Phase 1 では compute API がダッシュボードから自動呼び出しされるため
        // Worker 側の score ジョブは軽量版として is_stale のみ更新
        console.log(`[${WORKER_ID}] Score job for user ${(job.payload as { user_id: string }).user_id} — delegating to compute API`);
        break;
      case "notify":
        // 相互マッチ通知 — Phase 2 で Realtime 連携
        console.log(`[${WORKER_ID}] Notify job — placeholder`);
        break;
      default:
        console.warn(`[${WORKER_ID}] Unknown job type: ${job.type}`);
    }

    await completeJob(job.id);
    console.log(`[${WORKER_ID}] Completed job ${job.id}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${WORKER_ID}] Failed job ${job.id}:`, message);
    await failJob(job.id, message, job.attempts, job.max_attempts);
    return true; // ジョブは存在した
  }
}

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] Starting worker...`);

  // 起動時にstale lock解放
  const released = await releaseStaleJobs();
  if (released > 0) {
    console.log(`[${WORKER_ID}] Released ${released} stale jobs`);
  }

  // メインループ
  while (true) {
    try {
      let hadJob = true;
      // ジョブがある限り連続処理
      while (hadJob) {
        hadJob = await processJob();
      }
    } catch (error) {
      console.error(`[${WORKER_ID}] Poll error:`, error);
    }

    // ジョブがなければ待機
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

main().catch(console.error);
