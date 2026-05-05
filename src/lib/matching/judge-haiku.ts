/**
 * Haiku 判定結果アプリヤー
 * SCORING_V2_ARCHITECTURE.md §3 — Haiku 4-text crossmatch (+10 score core)
 *
 * 純粋関数モジュール: judge_pair_cache のキャッシュ行を読み込み、
 * カテゴリベースのスコアに上書きする need_offer_score / reverse_match を返す。
 *
 * Track-Main は computeScoreV2 の後（または compute-v2 route 内）で本関数を呼び、
 * 戻り値で needOfferScore / reverseMatch を差し替える。
 *
 * このモジュールは Anthropic SDK / Supabase に依存しない（Node/Edge どちらでも動く）。
 */

import type { NeedVector, OfferVector } from "./score-compute-v2";

/**
 * judge_pair_cache の 1 行に対応する形（スキーマ: 00020_haiku_judgment.sql）
 */
export interface JudgeCacheRow {
  /** viewer.need_vectors 配列内の 0-origin index */
  need_idx: number;
  /** target.offer_vectors 配列内の 0-origin index（reverse 方向では逆向きの意味） */
  offer_idx: number;
  /** 順方向: viewer.need ↔ target.offer の Haiku スコア (0-1) */
  h_no: number;
  /** 逆方向: target.need ↔ viewer.offer の Haiku スコア (0-1) */
  h_rv: number;
  reason_no?: string | null;
  reason_rv?: string | null;
}

export interface JudgeApplyResult {
  /** Haiku 上書き後の need_offer_score (0-1)。キャッシュなし → null（既存値を維持すべき） */
  needOfferScore: number | null;
  /** Haiku 上書き後の reverse_match (0-1)。同上 */
  reverseMatch: number | null;
  /** 採用された理由テキスト（最大2件、15字以内）。reasons[0]=順方向, reasons[1]=逆方向 */
  reasons: string[];
  /** 集計に使ったキャッシュ行数（0 ならキャッシュなし） */
  matchedPairs: number;
}

/**
 * § 3.2 の 4 テキストクロスマッチ結果（h_no/h_rv）が cacheRows に格納されている前提で、
 * confidence × weight 重み付き加重平均をとって need_offer_score / reverse_match を再構成する。
 *
 * 仕様:
 *  - キャッシュ行が 0 件なら null/null/[]/0 を返す（呼び出し側はカテゴリスコアを維持）
 *  - 各 viewer.need について、その need_idx を持つ行群の中で max(h_no) を採用
 *    （§3.2 「4 組のスコアの最大値を採用」を need × offer ペアレベルで実現済み）
 *  - 加重平均の重みは需要側 need.weight × need.confidence。weight が無い場合は 1, conf が無い場合は 0.7
 *  - 逆方向 (reverseMatch) も同じロジックで target.need × viewer.offer を集計
 *  - reasons は h_no / h_rv が最大の行の reason をそれぞれ 1 件採用（最大15字、15字に切り詰め）
 *  - LLM が確実性を出していない場合に備え、結果は [0,1] にクランプ
 */
export function applyHaikuJudgment(
  viewerNeeds: NeedVector[],
  viewerOffers: OfferVector[],
  targetNeeds: NeedVector[],
  targetOffers: OfferVector[],
  cacheRows: JudgeCacheRow[],
): JudgeApplyResult {
  if (!cacheRows || cacheRows.length === 0) {
    return { needOfferScore: null, reverseMatch: null, reasons: [], matchedPairs: 0 };
  }

  // need_idx でグルーピング: forward (viewer.need × target.offer)
  const fwdByNeed = new Map<number, JudgeCacheRow[]>();
  // offer_idx でグルーピング（reverse 方向では target.need_idx × viewer.offer_idx として再解釈）。
  // 注: スキーマ上 need_idx は viewer 側、offer_idx は target 側だが、reverse 計算では
  //   - h_rv = target.need[k] ↔ viewer.offer[m] のスコア
  //   - そのため target.need 側を index k = "need_idx" のスロットに同居させる場合は
  //     judge.ts 側で書き込むときに (need_idx, offer_idx) を (target.need_idx, viewer.offer_idx) として
  //     同一行に詰め込む契約とする（§3.2 「4 組のスコアの最大値を採用」）。
  //   よって reverse 用は target.need_idx でグループする = need_idx と同じキー。
  //   ただし reverseMatch の "重要度ウェイト" は target.need 側の weight/conf を使う。
  for (const row of cacheRows) {
    if (!fwdByNeed.has(row.need_idx)) fwdByNeed.set(row.need_idx, []);
    fwdByNeed.get(row.need_idx)!.push(row);
  }

  // ----------- forward (viewer.need ↔ target.offer) ------------
  const fwd = aggregateDirection(viewerNeeds, fwdByNeed, "h_no", "reason_no");

  // ----------- reverse (target.need ↔ viewer.offer) ------------
  const rev = aggregateDirection(targetNeeds, fwdByNeed, "h_rv", "reason_rv");

  // 既存の (recompute, no-input) 安全側: viewerNeeds.length === 0 でも cacheRows>0 ならゼロを返す
  // （applyHaikuJudgment が呼ばれている時点でユーザーは Haiku 判定対象になっているため、
  //  キャッシュなし以外は null を返さない方がスコア欠損より安全）

  // ピア unused 引数の警告を避けつつ、将来 weight 拡張のため引数として受け取っておく
  void viewerOffers;
  void targetOffers;

  const reasons: string[] = [];
  if (fwd.bestReason) reasons.push(truncate15(fwd.bestReason));
  if (rev.bestReason) reasons.push(truncate15(rev.bestReason));

  return {
    needOfferScore: clamp01(fwd.score),
    reverseMatch: clamp01(rev.score),
    reasons,
    matchedPairs: cacheRows.length,
  };
}

interface DirectionAgg {
  score: number;
  bestReason: string | null;
}

function aggregateDirection(
  needs: NeedVector[],
  byNeedIdx: Map<number, JudgeCacheRow[]>,
  scoreField: "h_no" | "h_rv",
  reasonField: "reason_no" | "reason_rv",
): DirectionAgg {
  if (needs.length === 0) return { score: 0, bestReason: null };

  let totalWeight = 0;
  let weighted = 0;
  let bestScore = -1;
  let bestReason: string | null = null;

  // P1 sparse-cache dilution 修正: cache 行のある needs だけを分母に取る。
  // TOP_N=50 / PER_VIEWER_DAILY_CAP=100 で worker が一部の needs しか
  // 判定できなかった場合、判定外 needs を分母に含めると score が不当に薄まる。
  // 「判定された範囲だけ」で加重平均を出し、判定範囲外は別 dimension (category)
  // で評価される設計に合わせる。
  for (let i = 0; i < needs.length; i++) {
    const need = needs[i]!;
    const w = (need.weight ?? 1) * (need.confidence ?? 0.7);
    if (w <= 0) continue;

    const rows = byNeedIdx.get(i);
    if (!rows || rows.length === 0) continue;

    let bestForNeed = 0;
    let bestRowReason: string | null = null;
    for (const row of rows) {
      const s = clamp01(row[scoreField] ?? 0);
      if (s > bestForNeed) {
        bestForNeed = s;
        const r = row[reasonField];
        bestRowReason = typeof r === "string" && r.length > 0 ? r : null;
      }
    }

    totalWeight += w; // cache 在 needs のみ分母に加算
    weighted += w * bestForNeed;

    if (bestForNeed > bestScore) {
      bestScore = bestForNeed;
      bestReason = bestRowReason;
    }
  }

  return {
    score: totalWeight > 0 ? weighted / totalWeight : 0,
    bestReason,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function truncate15(s: string): string {
  // Array.from で surrogate pair を 1 文字としてカウント（絵文字などの破損を回避）
  const chars = Array.from(s.trim());
  return chars.length <= 15 ? chars.join("") : chars.slice(0, 15).join("");
}
