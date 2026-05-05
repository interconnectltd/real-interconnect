/**
 * Haiku 判定結果アプリヤー (片方向専用 API)
 * SCORING_V2_ARCHITECTURE.md §3 — Haiku 4-text crossmatch (+10 score core)
 *
 * 純粋関数モジュール。worker (judge.ts) が direction='fwd' / 'rev' 別に書いた
 * judge_pair_cache 行を読み、片方向のスコアを返す。
 *
 * 旧版は forward / reverse を 1 関数で扱っていたが、cache 行の (need_idx, offer_idx)
 * 軸が方向により異なるため意味混在のリスクがあった (P8 HIGH 指摘)。
 * 本版は片方向のみ受け取り、cache 行の need_idx を「needs 配列」の index として
 * そのまま解釈する。呼び出し側で forward と reverse を 2 回呼べばよい。
 */

import type { NeedVector } from "./score-compute-v2";

/**
 * judge_pair_cache の 1 行 (片方向)。direction は呼び出し側で絞り込み済み前提。
 */
export interface JudgeCacheRow {
  /** その方向の "need" 配列内の 0-origin index */
  need_idx: number;
  /** その方向の "offer" 配列内の 0-origin index */
  offer_idx: number;
  /** その方向の Haiku スコア (0-1)。h_no/h_rv のうち呼び出し側がどちらかを採用 */
  h_no?: number;
  h_rv?: number;
  reason_no?: string | null;
  reason_rv?: string | null;
}

export interface JudgeApplyResult {
  /** Haiku の重み付き加重平均。cache 0 行なら null (呼び出し側はカテゴリベース維持) */
  score: number | null;
  /** 採用された理由テキスト (最大1件、15字以内) */
  reasons: string[];
  /** 集計に使ったキャッシュ行数 */
  matchedPairs: number;
}

/**
 * 片方向 Haiku 判定を適用。
 *
 *  - direction='fwd' で worker が書いた行: needs = viewer.needVectors, h_no を採用
 *  - direction='rev' で worker が書いた行: needs = target.needVectors, h_no を採用
 *    (reverse 視点では h_no = target.need × viewer.offer の Haiku スコア)
 *
 * 仕様:
 *  - cache 行が 0 件 → { score: null, reasons: [], matchedPairs: 0 }
 *  - cache 在 needs のみ分母に取る (sparse-cache dilution 防止)
 *  - 各 need について row 群の max(score) を採用
 *  - 加重平均の weight = need.weight × need.confidence
 */
export function applyHaikuJudgmentOneDirection(
  needs: NeedVector[],
  cacheRows: JudgeCacheRow[],
  field: "h_no" | "h_rv" = "h_no",
): JudgeApplyResult {
  if (!cacheRows || cacheRows.length === 0) {
    return { score: null, reasons: [], matchedPairs: 0 };
  }

  const reasonField = field === "h_no" ? "reason_no" : "reason_rv";
  const byNeed = new Map<number, JudgeCacheRow[]>();
  for (const r of cacheRows) {
    if (!byNeed.has(r.need_idx)) byNeed.set(r.need_idx, []);
    byNeed.get(r.need_idx)!.push(r);
  }

  let totalWeight = 0;
  let weighted = 0;
  let bestScore = -1;
  let bestReason: string | null = null;

  for (let i = 0; i < needs.length; i++) {
    const need = needs[i]!;
    const w = (need.weight ?? 1) * (need.confidence ?? 0.7);
    if (w <= 0) continue;
    const rows = byNeed.get(i);
    if (!rows || rows.length === 0) continue;

    let bestForNeed = 0;
    let bestRowReason: string | null = null;
    for (const row of rows) {
      const s = clamp01((row[field] as number | undefined) ?? 0);
      if (s > bestForNeed) {
        bestForNeed = s;
        const r = row[reasonField];
        bestRowReason = typeof r === "string" && r.length > 0 ? r : null;
      }
    }

    totalWeight += w;
    weighted += w * bestForNeed;

    if (bestForNeed > bestScore) {
      bestScore = bestForNeed;
      bestReason = bestRowReason;
    }
  }

  return {
    score: totalWeight > 0 ? clamp01(weighted / totalWeight) : null,
    reasons: bestReason ? [truncate15(bestReason)] : [],
    matchedPairs: cacheRows.length,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function truncate15(s: string): string {
  const chars = Array.from(s.trim());
  return chars.length <= 15 ? chars.join("") : chars.slice(0, 15).join("");
}
