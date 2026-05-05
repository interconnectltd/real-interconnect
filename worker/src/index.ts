/**
 * INTERCONNECT Worker
 * PostgreSQLジョブキューを5秒間隔でポーリングし、ジョブを実行
 */

import { claimJobDirect, completeJob, failJob, releaseStaleJobs } from "./queue";
import { handleAnalyze } from "./handlers/analyze";
import { handleAggregate } from "./handlers/aggregate";
import { handleJudgePairBatch, type JudgePairBatchPayload } from "./handlers/judge";
import { handleEmbed } from "./handlers/embed";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_INTERVAL = 5000;
let isShuttingDown = false;

// --- 起動時バリデーション ---
function validateEnv(): void {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "AI_API_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[${WORKER_ID}] Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// --- グレースフルシャットダウン ---
function setupShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    console.log(`[${WORKER_ID}] ${signal} received, shutting down gracefully...`);
    isShuttingDown = true;
    // 現在のジョブが完了するまで最大30秒待機
    setTimeout(() => {
      console.log(`[${WORKER_ID}] Forced exit after timeout`);
      process.exit(0);
    }, 30000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

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
        console.log(`[${WORKER_ID}] Score job for user ${(job.payload as { user_id: string }).user_id} — delegating to compute API`);
        break;
      case "judge_pair_batch":
        await handleJudgePairBatch(job.payload as unknown as JudgePairBatchPayload);
        break;
      case "embed":
        await handleEmbed(job.payload as { user_id: string });
        break;
      case "notify":
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
    return true;
  }
}

async function main(): Promise<void> {
  validateEnv();
  setupShutdownHandlers();

  console.log(`[${WORKER_ID}] Starting worker...`);
  console.log(`[${WORKER_ID}] Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`[${WORKER_ID}] AI API key: ${process.env.AI_API_KEY ? "set" : "MISSING"}`);

  // 起動時にstale lock解放
  const released = await releaseStaleJobs();
  if (released > 0) {
    console.log(`[${WORKER_ID}] Released ${released} stale jobs`);
  }

  console.log(`[${WORKER_ID}] Polling every ${POLL_INTERVAL / 1000}s...`);

  // メインループ
  while (!isShuttingDown) {
    try {
      let hadJob = true;
      while (hadJob && !isShuttingDown) {
        hadJob = await processJob();
      }
    } catch (error) {
      console.error(`[${WORKER_ID}] Poll error:`, error);
    }

    if (!isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  console.log(`[${WORKER_ID}] Worker stopped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[${WORKER_ID}] Fatal error:`, err);
  process.exit(1);
});
