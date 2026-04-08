/**
 * 統合スコア計算
 * 設計書 1-08 成熟度モデル + ARCHITECTURE.md
 *
 * Lv1(0回): attribute(0.70) + purpose(0.20) + conversation(0.00) + history(0.10)
 * Lv2(1-4): attribute(0.25) + purpose(0.20) + conversation(0.40) + history(0.15)
 * Lv3(5+):  attribute(0.10) + purpose(0.15) + conversation(0.45) + history(0.30)
 */

import { calcAttributeScore } from "./attribute-score";
import { calcPurposeScore, type PurposeScoreResult, type GoalOffering } from "./purpose-score";
import { generateReasons, type ReasonContext } from "./reason-templates";
import { MATURITY_WEIGHTS } from "@/lib/constants";
import type { ScorePhase, NotifyTier } from "@/types";

export interface ScoreInput {
  viewer: {
    id: string;
    industry?: string | null;
    position?: string | null;
    bio?: string | null;
    analysisCount: number;
    goals?: GoalOffering[];
    offerings?: GoalOffering[];
  };
  target: {
    id: string;
    name?: string | null;
    industry?: string | null;
    position?: string | null;
    bio?: string | null;
    company?: string | null;
    analysisCount: number;
    goals?: GoalOffering[];
    offerings?: GoalOffering[];
  };
  aiScores?: {
    conversation: number;   // 0-1
  };
  sharedMeetingCount: number;
  matchedNeeds?: string[];
  matchedSkills?: string[];
  matchedOfferings?: string[];
  usedTemplateIds: Set<string>;
}

export interface ScoreResult {
  valueFit: number;
  relationalQuality: number;
  totalScore: number;
  confidence: number;
  phase: ScorePhase;
  reasons: string[];
  notifyTier: NotifyTier | null;
  purposeDetail?: PurposeScoreResult;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { viewer, target, aiScores, sharedMeetingCount } = input;

  // ── 成熟度レベル判定 ──
  const minCount = Math.min(viewer.analysisCount, target.analysisCount);
  let level: 1 | 2 | 3;
  let phase: ScorePhase;

  if (minCount === 0) {
    level = 1;
    phase = "attribute_only";
  } else if (minCount <= 4) {
    level = 2;
    phase = "hybrid";
  } else {
    level = 3;
    phase = "ai_primary";
  }

  const weights = MATURITY_WEIGHTS[level];

  // ── 属性スコア (業種/職種/bio) ──
  const attr = calcAttributeScore(viewer, target);

  // ── 目的交差スコア (goals×offerings) ──
  const purpose = calcPurposeScore(
    viewer.goals ?? [],
    viewer.offerings ?? [],
    target.goals ?? [],
    target.offerings ?? [],
  );

  // ── 会話スコア (AI分析後) ──
  const conversationScore = aiScores?.conversation ?? 0;

  // ── 交流履歴スコア ──
  const historyScore = Math.min(1.0,
    sharedMeetingCount >= 4 ? (20 + 15 + 10 + (sharedMeetingCount - 3) * 5) / 100
    : sharedMeetingCount === 3 ? 45 / 100
    : sharedMeetingCount === 2 ? 35 / 100
    : sharedMeetingCount === 1 ? 20 / 100
    : 0,
  );

  // ── 信頼度 ──
  const confidence = Math.min(minCount / 7, 1.0);

  // ── AI会話スコアにのみ shrinkage 適用 ──
  const shrinkConversation = confidence * conversationScore + (1 - confidence) * 0.50;

  // ── 成熟度モデルに基づく統合 ──
  const totalScore =
    weights.attribute * attr.valueFit +
    weights.purpose * purpose.score +
    weights.conversation * (level === 1 ? 0 : shrinkConversation) +
    weights.history * historyScore;

  // value_fit / relational_quality に分解（UI表示用）
  const valueFit = attr.valueFit * 0.6 + purpose.score * 0.4;
  const relationalQuality = level === 1
    ? 0.50
    : shrinkConversation * 0.7 + historyScore * 0.3;

  // ── 通知 tier ──
  let notifyTier: NotifyTier | null = null;
  if (totalScore >= 0.75 && confidence >= 0.6) notifyTier = "high";
  else if (totalScore >= 0.60 && confidence >= 0.4) notifyTier = "medium";
  else if (totalScore >= 0.50) notifyTier = "low";

  // ── 理由生成 ──
  const reasonCtx: ReasonContext = {
    viewer,
    target,
    valueFit,
    relationalQuality,
    confidence,
    sharedMeetingCount,
    matchedNeeds: input.matchedNeeds,
    matchedSkills: input.matchedSkills,
    matchedOfferings: input.matchedOfferings,
    // goals×offerings マッチ情報を渡す
    purposeForwardMatches: purpose.forwardMatches.map((m) => m.goalLabel),
    purposeReverseMatches: purpose.reverseMatches.map((m) => m.goalLabel),
    purposeSharedGoals: purpose.sharedGoals,
    usedTemplateIds: input.usedTemplateIds,
  };
  const reasons = generateReasons(reasonCtx);

  return {
    valueFit,
    relationalQuality,
    totalScore,
    confidence,
    phase,
    reasons,
    notifyTier,
    purposeDetail: purpose,
  };
}
