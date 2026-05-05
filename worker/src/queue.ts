/**
 * PostgreSQL ジョブキュー
 * ARCHITECTURE.md §4.2
 */

import { createClient } from "@supabase/supabase-js";

// Secret 値の末尾改行 / 空白 / trailing slash / "/rest/v1" を防御的に除去
// (Supabase ダッシュボードからコピーすると `https://x.supabase.co/rest/v1` が貼られるケースあり)
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .trim()
  .replace(/\/rest\/v1\/?$/, "")
  .replace(/\/+$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * ジョブタイプ定義 (single source of truth)
 *  - analyze:           Opus による transcript_insights 抽出 (handlers/analyze.ts)
 *  - aggregate:         transcript_insights → user_conversation_vectors 集約 (handlers/aggregate.ts)
 *  - score:             カテゴリベース 5 次元スコア計算 (Next.js compute-v2 route)
 *  - judge_pair_batch:  Haiku 4-text crossmatch 判定 (handlers/judge.ts) — SCORING_V2_ARCHITECTURE.md §3
 *  - notify:            プッシュ通知 (placeholder)
 */
export const JOB_TYPES = {
  ANALYZE: "analyze",
  AGGREGATE: "aggregate",
  SCORE: "score",
  JUDGE_PAIR_BATCH: "judge_pair_batch",
  NOTIFY: "notify",
} as const;

export type JobType = typeof JOB_TYPES[keyof typeof JOB_TYPES];

export interface Job {
  id: string;
  type: JobType | string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** ジョブ取得 (SELECT FOR UPDATE SKIP LOCKED) */
export async function claimJob(workerId: string): Promise<Job | null> {
  const { data, error } = await supabase.rpc("claim_job", {
    p_worker_id: workerId,
  });

  if (error || !data) return null;
  return data as unknown as Job;
}

/** RPC が使えない場合のフォールバック (直接クエリ) */
export async function claimJobDirect(workerId: string): Promise<Job | null> {
  // pending かつ scheduled_at <= now のジョブを1件取得
  const { data: jobs } = await supabase
    .from("job_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("priority", { ascending: false })
    .order("scheduled_at", { ascending: true })
    .limit(1);

  if (!jobs?.length) return null;
  const job = jobs[0]!;

  // ロック取得
  const { data, error } = await supabase
    .from("job_queue")
    .update({
      status: "running",
      locked_at: new Date().toISOString(),
      locked_by: workerId,
      attempts: (job.attempts ?? 0) + 1,
    })
    .eq("id", job.id)
    .eq("status", "pending") // 楽観的ロック
    .select()
    .single();

  if (error || !data) return null; // 他のworkerが先に取った
  return data as Job;
}

/** ジョブ完了 */
export async function completeJob(jobId: string): Promise<void> {
  await supabase
    .from("job_queue")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/** ジョブ失敗 (リトライまたはdead) */
export async function failJob(
  jobId: string,
  error: string,
  attempts: number,
  maxAttempts: number,
): Promise<void> {
  if (attempts >= maxAttempts) {
    await supabase
      .from("job_queue")
      .update({ status: "dead", last_error: error })
      .eq("id", jobId);
    return;
  }

  // 指数バックオフ: 30s, 120s, 480s
  const delaySec = 30 * Math.pow(4, attempts - 1);
  const scheduledAt = new Date(Date.now() + delaySec * 1000).toISOString();

  await supabase
    .from("job_queue")
    .update({
      status: "pending",
      last_error: error,
      locked_at: null,
      locked_by: null,
      scheduled_at: scheduledAt,
    })
    .eq("id", jobId);
}

/** stale ロックの解放 (5分超) */
export async function releaseStaleJobs(): Promise<number> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("job_queue")
    .update({
      status: "pending",
      locked_at: null,
      locked_by: null,
    })
    .eq("status", "running")
    .lt("locked_at", fiveMinAgo)
    .select("id");

  return data?.length ?? 0;
}

/** 新しいジョブを投入 (重複防止付き) */
export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  priority = 0,
): Promise<void> {
  // 同じtype+payloadのpending/runningが存在しなければINSERT
  const payloadStr = JSON.stringify(payload);

  const { data: existing } = await supabase
    .from("job_queue")
    .select("id")
    .eq("type", type)
    .in("status", ["pending", "running"])
    .eq("payload", payloadStr)
    .limit(1);

  if (existing?.length) return; // 既に存在

  await supabase.from("job_queue").insert({
    type,
    payload,
    priority,
    status: "pending",
  });
}

export { supabase };
