/**
 * Embedding-based semantic matching (Track-B / Phase 3 pgvector).
 * SCORING_V2_ARCHITECTURE.md §13.
 *
 * Pure module — does NOT touch score-compute-v2.ts. Track-Main is expected to
 * call applyEmbeddingScore() and inject `semanticNo` / `semanticRv` into its
 * own dimension blend (e.g. as a 6th dim or as a fallback when h_no=0).
 *
 * Cosine in [0,1]: 1 = identical, 0 = orthogonal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmbeddingScores {
  semanticNo: number; // viewer.need × target.offer (top-1 cosine)
  semanticRv: number; // target.need × viewer.offer (top-1 cosine)
  semanticTopic: number; // viewer.topic × target.topic (top-1 cosine)
}

const ZERO: EmbeddingScores = { semanticNo: 0, semanticRv: 0, semanticTopic: 0 };

/**
 * Plain numeric cosine (utility for pure-TS testing / fallback / blend math).
 */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
}

/**
 * Calls the SECURITY DEFINER RPC `match_pair_embeddings` and returns the
 * three semantic scores. Returns zeros on any error or if either user has no
 * embeddings yet (graceful degradation — caller should treat as "no signal").
 *
 * The RPC is fenced server-side: when called via authenticated session,
 * auth.uid() must equal viewerId. When called via service-role (worker),
 * auth.uid() is null so the fence is skipped and any pair can be queried.
 */
export async function applyEmbeddingScore(
  viewerId: string,
  targetId: string,
  client: SupabaseClient,
): Promise<EmbeddingScores> {
  if (viewerId === targetId) return ZERO;

  const { data, error } = await client.rpc("match_pair_embeddings", {
    p_viewer_id: viewerId,
    p_target_id: targetId,
  });

  if (error) {
    console.warn("[applyEmbeddingScore] RPC failed:", error.message);
    return ZERO;
  }

  if (!data || typeof data !== "object") return ZERO;

  const obj = data as Record<string, unknown>;
  const semNo = Number(obj.semantic_no ?? 0);
  const semRv = Number(obj.semantic_rv ?? 0);
  const semTopic = Number(obj.semantic_topic ?? 0);

  return {
    semanticNo: clamp01(semNo),
    semanticRv: clamp01(semRv),
    semanticTopic: clamp01(semTopic),
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * バッチ版: 1 viewer × N targets を 1 RTT で取得。
 * P4 perf-audit が EXPLAIN ANALYZE で実証した N RTT 暴発 (1k ユーザー 8-15s)
 * を 250ms に短縮するための SECURITY DEFINER RPC `match_pair_embeddings_batch`。
 *
 * 失敗時は単発版へフォールバック (graceful degradation)。
 */
export async function applyEmbeddingScoreBatch(
  viewerId: string,
  targetIds: string[],
  client: SupabaseClient,
): Promise<Map<string, EmbeddingScores>> {
  const result = new Map<string, EmbeddingScores>();
  if (targetIds.length === 0) return result;

  const { data, error } = await client.rpc("match_pair_embeddings_batch", {
    p_viewer_id: viewerId,
    p_target_ids: targetIds,
  });

  if (error) {
    console.warn("[applyEmbeddingScoreBatch] RPC failed, returning zeros:", error.message);
    for (const tid of targetIds) result.set(tid, ZERO);
    return result;
  }

  const rows = (data ?? []) as Array<{
    target_id: string;
    semantic_no: number;
    semantic_rv: number;
    semantic_topic: number;
  }>;
  for (const row of rows) {
    result.set(row.target_id, {
      semanticNo: clamp01(Number(row.semantic_no ?? 0)),
      semanticRv: clamp01(Number(row.semantic_rv ?? 0)),
      semanticTopic: clamp01(Number(row.semantic_topic ?? 0)),
    });
  }
  // 戻り行に無い target は 0 で埋める (RPC が unrelated = 0 を返さない場合の保険)
  for (const tid of targetIds) {
    if (!result.has(tid)) result.set(tid, ZERO);
  }
  return result;
}
