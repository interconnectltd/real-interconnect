/**
 * V2 スコア計算エンジン
 * SCORING_V2_ARCHITECTURE.md §4 — 5次元 + 動的重み + ブースト + alpha + 単調保証
 */

import { calcAttributeScore } from "./attribute-score";
import { calcPurposeScore } from "./purpose-score";
import { applyHaikuJudgment, type JudgeCacheRow } from "./judge-haiku";
import type { EmbeddingScores } from "./embedding";

// 意味空間スコアを score スケール [0,1] に持ち上げる
// text-embedding-3-small の B2B 同言語 cosine は 0.55-0.85 帯に集中するため、
// 0.55 未満は無関係扱い、0.92 以上で 0.85 にキャップ (単独 signal で完全マッチ扱いさせない)。
// P2 指摘 #1 への対応。
function semanticToScore(c: number): number {
  if (!Number.isFinite(c) || c <= 0.55) return 0;
  if (c >= 0.92) return 0.85;
  // 線形 0.55→0 / 0.92→0.85
  return ((c - 0.55) / 0.37) * 0.85;
}

// --- カテゴリ正規化（日本語→英語マッピング） ---
const VALID_CATEGORIES = new Set([
  "sales", "marketing", "technology", "finance", "hr", "legal",
  "operations", "strategy", "design", "industry", "leadership", "other",
]);

const JA_TO_EN_CATEGORY: [RegExp, string][] = [
  [/営業|販路|セールス/, "sales"],
  [/マーケティング|広告|PR/, "marketing"],
  [/テクノロジー|技術|IT|エンジニア/, "technology"],
  [/金融|保険|ファイナンス|資金/, "finance"],
  [/人事|採用|HR|組織/, "hr"],
  [/法務|コンプライアンス|法律/, "legal"],
  [/オペレーション|運用|業務|経営基盤|インフラ/, "operations"],
  [/戦略|事業開発|提携|アライアンス|経営戦略/, "strategy"],
  [/デザイン|UI|UX/, "design"],
  [/製造|ヘルスケア|教育|不動産|業界/, "industry"],
  [/リーダーシップ|経営|マネジメント|代表/, "leadership"],
  [/ネットワーキング|コミュニティ/, "other"],
];

export function normalizeCategory(cat: string): string {
  if (!cat) return "other";
  const lower = cat.toLowerCase();
  if (VALID_CATEGORIES.has(lower)) return lower;
  for (const [pattern, en] of JA_TO_EN_CATEGORY) {
    if (pattern.test(cat)) return en;
  }
  return "other";
}

// --- 隣接カテゴリマップ (§5.3, 11ペア双方向) ---
const ADJACENT: Record<string, string[]> = {
  technology: ["strategy", "design", "operations"],
  strategy: ["technology", "finance", "leadership", "hr"],
  finance: ["strategy", "legal"],
  legal: ["finance", "operations"],
  hr: ["leadership", "strategy"],
  leadership: ["hr", "strategy"],
  marketing: ["sales", "design"],
  sales: ["marketing"],
  design: ["technology", "marketing"],
  operations: ["technology", "legal"],
};

function isAdjacent(catA: string, catB: string): boolean {
  return ADJACENT[catA]?.includes(catB) || ADJACENT[catB]?.includes(catA) || false;
}

// --- 型定義 ---
export interface NeedVector {
  text: string;
  category?: string;
  subcategory?: string;
  solver_profile?: string;
  confidence?: number;
  weight?: number;
  frequency?: number;
  decay_weight?: number;
  urgency?: string;
}

export interface OfferVector {
  text: string;
  category?: string;
  subcategory?: string;
  beneficiary_profile?: string;
  confidence?: number;
  weight?: number;
  frequency?: number;
  decay_weight?: number;
  credibility?: string;
}

export interface TopicVector {
  topic: string;
  category?: string;
  depth: number;
  mention_count?: number;
  decay_weight?: number;
}

export interface EngagementSignature {
  asks_clarifying_questions?: number;
  references_own_experience?: number;
  shows_active_listening?: number;
  contributes_solutions?: number;
  expresses_interest_follow_up?: number;
}

export interface ScoringConfig {
  weights_json: {
    high: Record<string, number>;
    medium: Record<string, number>;
    low: Record<string, number>;
    thresholds: { high: number; medium: number };
  };
  alpha_table_json: Record<string, number>;
  boost_params_json: Record<string, number>;
}

export interface ScoreV2Input {
  viewer: {
    id: string;
    industry?: string | null;
    position?: string | null;
    bio?: string | null;
    analysisCount: number;
    goals?: { type: string }[];
    offerings?: { type: string }[];
    needVectors: NeedVector[];
    offerVectors: OfferVector[];
    topicVectors: TopicVector[];
    engagementSignature: EngagementSignature;
  };
  target: {
    id: string;
    name?: string | null;
    industry?: string | null;
    position?: string | null;
    bio?: string | null;
    company?: string | null;
    analysisCount: number;
    goals?: { type: string }[];
    offerings?: { type: string }[];
    needVectors: NeedVector[];
    offerVectors: OfferVector[];
    topicVectors: TopicVector[];
    engagementSignature: EngagementSignature;
  };
  sharedMeetingCount: number;
  config: ScoringConfig;
  /** Haiku 4-text crossmatch のキャッシュ行 (00020_haiku_judgment.sql)。空配列なら無視。 */
  judgeCacheRows?: JudgeCacheRow[];
  /** pgvector cosine から取得した意味空間スコア (00021_pgvector.sql)。未指定なら無視。 */
  embeddingScores?: EmbeddingScores;
}

export interface ScoreV2Result {
  needOfferScore: number;
  reverseMatch: number;
  expertiseFit: number;
  topicAlignment: number;
  engagementValue: number;
  historyScore: number;
  totalScore: number;
  confidence: number;
  phase: "attribute_only" | "hybrid" | "ai_primary";
  reasons: string[];
  notifyTier: "high" | "medium" | "low" | null;
}

// =====================================================================
// Dimension 1: ニーズ×オファーマッチ（カテゴリベース）
// =====================================================================
function calcNeedOfferScore(needs: NeedVector[], offers: OfferVector[]): number {
  if (needs.length === 0) return 0;

  let totalWeight = 0;
  let matchedWeight = 0;

  for (const need of needs) {
    const w = need.weight ?? 1;
    totalWeight += w;

    let bestMatch = 0;
    for (const offer of offers) {
      let catMatch = 0;
      const needCat = need.category ? normalizeCategory(need.category) : undefined;
      const offerCat = offer.category ? normalizeCategory(offer.category) : undefined;
      if (need.subcategory && offer.subcategory && need.subcategory === offer.subcategory) {
        catMatch = 1.0;
      } else if (needCat && offerCat && needCat === offerCat) {
        catMatch = 0.5;
      } else if (needCat && offerCat && isAdjacent(needCat, offerCat)) {
        catMatch = 0.4;
      }

      // テキスト類似フォールバック
      if (catMatch === 0 && need.text && offer.text) {
        const needWords = need.text.toLowerCase().split(/[\s、。,./]+/).filter(w => w.length >= 2);
        const offerWords = offer.text.toLowerCase().split(/[\s、。,./]+/).filter(w => w.length >= 2);
        const common = needWords.filter(w => offerWords.some(ow => ow.includes(w) || w.includes(ow)));
        if (common.length >= 2) catMatch = 0.2;
      }

      const matchStrength = catMatch * Math.min(need.confidence ?? 0.7, offer.confidence ?? 0.7);
      if (matchStrength > bestMatch) bestMatch = matchStrength;
    }

    matchedWeight += w * bestMatch;
  }

  return totalWeight > 0 ? matchedWeight / totalWeight : 0;
}

// =====================================================================
// Dimension 3: 専門性適合
// =====================================================================
function calcExpertiseFit(viewerNeeds: NeedVector[], targetOffers: OfferVector[]): number {
  if (targetOffers.length === 0) return 0;

  let totalWeight = 0;
  let fitScore = 0;

  for (const offer of targetOffers) {
    const w = offer.weight ?? 1;
    totalWeight += w;

    let bestFit = 0.1; // 無関係のベース
    const offerCat = offer.category ? normalizeCategory(offer.category) : undefined;
    for (const need of viewerNeeds) {
      const needCat = need.category ? normalizeCategory(need.category) : undefined;
      if (need.subcategory && offer.subcategory && need.subcategory === offer.subcategory) {
        bestFit = Math.max(bestFit, 0.5); // ピア
      } else if (needCat && offerCat && needCat === offerCat) {
        bestFit = Math.max(bestFit, 1.0); // 補完的（最高）
      } else if (needCat && offerCat && isAdjacent(needCat, offerCat)) {
        bestFit = Math.max(bestFit, 0.4);
      }
    }

    fitScore += w * bestFit;
  }

  return totalWeight > 0 ? Math.min(fitScore / totalWeight, 1.0) : 0;
}

// =====================================================================
// Dimension 4: トピック親和性
// =====================================================================
function calcTopicAlignment(viewerTopics: TopicVector[], targetTopics: TopicVector[]): number {
  if (viewerTopics.length === 0 || targetTopics.length === 0) return 0;

  let totalWeight = 0;
  let alignment = 0;

  for (const vt of viewerTopics) {
    const w = vt.decay_weight ?? 1;
    totalWeight += w;

    for (const tt of targetTopics) {
      let catMatch = 0;
      const vtCat = vt.category ? normalizeCategory(vt.category) : undefined;
      const ttCat = tt.category ? normalizeCategory(tt.category) : undefined;
      if (vtCat && ttCat) {
        if (vtCat === ttCat) catMatch = 0.5;
        // トピックテキスト部分一致
        if (vt.topic && tt.topic && (vt.topic.includes(tt.topic) || tt.topic.includes(vt.topic))) {
          catMatch = 1.0;
        }
      }

      if (catMatch > 0) {
        alignment += catMatch * (vt.depth ?? 0.5) * (tt.depth ?? 0.5) * w;
      }
    }
  }

  return totalWeight > 0 ? Math.min(alignment / totalWeight, 1.0) : 0;
}

// =====================================================================
// Dimension 5: エンゲージメント価値
// =====================================================================
function calcEngagementValue(signature: EngagementSignature): number {
  const weights: Record<string, number> = {
    contributes_solutions: 0.30,
    expresses_interest_follow_up: 0.25,
    references_own_experience: 0.20,
    asks_clarifying_questions: 0.15,
    shows_active_listening: 0.10,
  };

  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    score += (signature[key as keyof EngagementSignature] ?? 0) * weight;
  }

  return Math.min(score, 1.0);
}

// =====================================================================
// History Score（V1互換）
// =====================================================================
function calcHistoryScore(sharedMeetings: number): number {
  if (sharedMeetings >= 4) return Math.min(1.0, (20 + 15 + 10 + (sharedMeetings - 3) * 5) / 100);
  if (sharedMeetings === 3) return 0.45;
  if (sharedMeetings === 2) return 0.35;
  if (sharedMeetings === 1) return 0.20;
  return 0;
}

// =====================================================================
// メイン: computeScoreV2
// =====================================================================
export function computeScoreV2(input: ScoreV2Input): ScoreV2Result {
  const { viewer, target, sharedMeetingCount, config, judgeCacheRows, embeddingScores } = input;

  // --- 5次元計算（カテゴリベース、ベースライン）---
  let needOfferScore = calcNeedOfferScore(viewer.needVectors, target.offerVectors);
  let reverseMatch = calcNeedOfferScore(target.needVectors, viewer.offerVectors);
  const expertiseFit = calcExpertiseFit(viewer.needVectors, target.offerVectors);
  let topicAlignment = calcTopicAlignment(viewer.topicVectors, target.topicVectors);
  const engagementValue = calcEngagementValue(target.engagementSignature);
  const historyScore = calcHistoryScore(sharedMeetingCount);

  // --- Haiku / Embedding は片側でも会話分析がある場合のみ反映 (P2 指摘 #3) ---
  // analysisCount=0 (両ユーザー) のときは Haiku/Embedding が dimension fields に
  // 漏れないよう gate。alpha=0 で totalScore は守られるが、reason/UI が
  // 「属性のみ」と表示しつつ Haiku 由来の値を返すと整合性が崩れる。
  const minAnalysis = Math.min(viewer.analysisCount, target.analysisCount);
  const partialAnalysis = viewer.analysisCount > 0 || target.analysisCount > 0;
  let haikuReasons: string[] = [];

  if (minAnalysis > 0 || partialAnalysis) {
    // Haiku LLM 判定の上書き (§3「+10 score core」)
    if (judgeCacheRows && judgeCacheRows.length > 0) {
      const haiku = applyHaikuJudgment(
        viewer.needVectors,
        viewer.offerVectors,
        target.needVectors,
        target.offerVectors,
        judgeCacheRows,
      );
      if (haiku.needOfferScore !== null) needOfferScore = haiku.needOfferScore;
      if (haiku.reverseMatch !== null) reverseMatch = haiku.reverseMatch;
      haikuReasons = haiku.reasons;
    }

    // 意味空間 (pgvector) によるフォールバック / 補正
    // P2 指摘 #2: max() で三重カウントしないよう 0.7 cat + 0.3 sem の加重ブレンド。
    // ただし category=0 のときに限り max を採用 (純 fallback)。
    if (embeddingScores) {
      const sNo = semanticToScore(embeddingScores.semanticNo);
      const sRv = semanticToScore(embeddingScores.semanticRv);
      const sTopic = semanticToScore(embeddingScores.semanticTopic);
      if (!judgeCacheRows || judgeCacheRows.length === 0) {
        needOfferScore = needOfferScore <= 0.05 ? sNo : 0.7 * needOfferScore + 0.3 * sNo;
        reverseMatch = reverseMatch <= 0.05 ? sRv : 0.7 * reverseMatch + 0.3 * sRv;
      }
      topicAlignment = topicAlignment <= 0.05 ? sTopic : 0.7 * topicAlignment + 0.3 * sTopic;
    }
  }

  // --- 動的重み ---
  const thresholds = config.weights_json.thresholds;
  let weightTier: "high" | "medium" | "low";
  if (needOfferScore >= thresholds.high) weightTier = "high";
  else if (needOfferScore >= thresholds.medium) weightTier = "medium";
  else weightTier = "low";

  const w = config.weights_json[weightTier];

  let convScore =
    (w.need_offer ?? 0.40) * needOfferScore +
    (w.reverse_match ?? 0.18) * reverseMatch +
    (w.expertise_fit ?? 0.18) * expertiseFit +
    (w.topic_alignment ?? 0.12) * topicAlignment +
    (w.engagement_value ?? 0.12) * engagementValue;

  // --- ブースト (P7 HIGH BUG-1 修正: gate と bonus を分離) ---
  // 旧: bp.threshold_85 (= 0.08) を gate にも使い、needOffer>=0.08 で常時発火していた。
  // gate は SCORING_V2_ARCHITECTURE.md §4.3 の通りリテラル 0.85 / 0.70、
  // bonus 量だけ config から読む。
  const bp = config.boost_params_json;
  if (needOfferScore >= 0.85) convScore += bp.threshold_85 ?? 0.08;
  else if (needOfferScore >= 0.70) convScore += bp.threshold_70 ?? 0.04;

  // --- 属性スコア（V1関数を再利用） ---
  const attr = calcAttributeScore(
    { industry: viewer.industry, position: viewer.position, bio: viewer.bio },
    { industry: target.industry, position: target.position, bio: target.bio },
  );
  const purpose = calcPurposeScore(
    viewer.goals ?? [], viewer.offerings ?? [],
    target.goals ?? [], target.offerings ?? [],
  );
  const attrScore = 0.60 * attr.valueFit + 0.25 * purpose.score + 0.15 * historyScore;

  // --- Surprise bonus ---
  if (attrScore < (bp.surprise_attr_max ?? 0.45) && convScore > (bp.surprise_conv_min ?? 0.45)) {
    convScore += Math.min(bp.surprise_bonus_max ?? 0.06, (convScore - 0.45) * 0.12);
  }

  // --- Alpha (minAnalysis は Haiku gate ですでに宣言済み) ---
  const alphaTable = config.alpha_table_json;
  let alpha: number;
  if (minAnalysis === 0) {
    // 片側データチェック
    if (viewer.analysisCount > 0 || target.analysisCount > 0) {
      alpha = alphaTable.partial ?? 0.20;
    } else {
      alpha = 0;
    }
  } else {
    alpha = alphaTable[String(Math.min(minAnalysis, 4))] ?? 0.95;
  }

  // --- ブレンド ---
  let totalScore = alpha * convScore + (1 - alpha) * attrScore;

  // --- 方向性付き単調保証 ---
  const monotonicThreshold = bp.monotonic_threshold ?? 0.40;
  if (minAnalysis > 0 && convScore > monotonicThreshold) {
    totalScore = Math.max(totalScore, attrScore);
  }

  // --- フェーズ ---
  let phase: "attribute_only" | "hybrid" | "ai_primary";
  if (minAnalysis === 0) phase = "attribute_only";
  else if (minAnalysis <= 3) phase = "hybrid";
  else phase = "ai_primary";

  // --- 信頼度（通知用のみ） ---
  const confidence = Math.min(minAnalysis / 5, 1.0);

  // --- 通知tier ---
  let notifyTier: "high" | "medium" | "low" | null = null;
  if (totalScore >= 0.75 && confidence >= 0.6) notifyTier = "high";
  else if (totalScore >= 0.60 && confidence >= 0.4) notifyTier = "medium";
  else if (totalScore >= 0.50) notifyTier = "low";

  // --- 理由生成は外部で / Haiku 由来 reason は haikuReasons で別ルート ---
  return {
    needOfferScore, reverseMatch, expertiseFit, topicAlignment,
    engagementValue, historyScore, totalScore, confidence, phase,
    reasons: haikuReasons, // Haiku 由来の reason をパススルー (compute-v2 route で属性 reason と merge)
    notifyTier,
  };
}
