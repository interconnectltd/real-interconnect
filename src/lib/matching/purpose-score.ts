/**
 * Goals×Offerings 交差スコア計算
 * 設計書 1-08, 1-09: マッチングの核心
 */

import { GOAL_TYPES } from "@/lib/constants";

interface GoalOffering {
  type: string;
  context?: string | null;
}

const GOAL_LABELS = Object.fromEntries(
  GOAL_TYPES.map((g) => [g.value, g.label]),
);

/**
 * 片方向の交差スコア:
 * viewerのgoalsのうち、targetのofferingsで満たされる割合
 */
function onewayScore(
  viewerGoals: GoalOffering[],
  targetOfferings: GoalOffering[],
): { score: number; matches: { goalType: string; goalLabel: string; offeringContext?: string }[] } {
  if (viewerGoals.length === 0) return { score: 0, matches: [] };

  const offeringTypes = new Set(targetOfferings.map((o) => o.type));
  const offeringByType = new Map(targetOfferings.map((o) => [o.type, o]));
  const matches: { goalType: string; goalLabel: string; offeringContext?: string }[] = [];

  let matchCount = 0;
  for (const goal of viewerGoals) {
    if (offeringTypes.has(goal.type)) {
      matchCount++;
      const offering = offeringByType.get(goal.type);
      matches.push({
        goalType: goal.type,
        goalLabel: GOAL_LABELS[goal.type] ?? goal.type,
        offeringContext: offering?.context ?? undefined,
      });
    }
  }

  return {
    score: matchCount / viewerGoals.length,
    matches,
  };
}

export interface PurposeScoreResult {
  /** 双方向平均スコア (0-1) */
  score: number;
  /** viewer→target の交差スコア */
  forwardScore: number;
  /** target→viewer の交差スコア */
  reverseScore: number;
  /** viewer のゴールに対する target の提供マッチ */
  forwardMatches: { goalType: string; goalLabel: string; offeringContext?: string }[];
  /** target のゴールに対する viewer の提供マッチ */
  reverseMatches: { goalType: string; goalLabel: string; offeringContext?: string }[];
  /** 同じgoalを持っている（共通ニーズ） */
  sharedGoals: string[];
}

export function calcPurposeScore(
  viewerGoals: GoalOffering[],
  viewerOfferings: GoalOffering[],
  targetGoals: GoalOffering[],
  targetOfferings: GoalOffering[],
): PurposeScoreResult {
  const forward = onewayScore(viewerGoals, targetOfferings);
  const reverse = onewayScore(targetGoals, viewerOfferings);

  // 共通のgoal (同じ悩みを持つ人)
  const viewerGoalTypes = new Set(viewerGoals.map((g) => g.type));
  const sharedGoals = targetGoals
    .filter((g) => viewerGoalTypes.has(g.type))
    .map((g) => GOAL_LABELS[g.type] ?? g.type);

  // 双方向平均。片方がgoalsゼロの場合はもう片方のスコアのみ
  let score: number;
  if (viewerGoals.length === 0 && targetGoals.length === 0) {
    score = 0;
  } else if (viewerGoals.length === 0) {
    score = reverse.score;
  } else if (targetGoals.length === 0) {
    score = forward.score;
  } else {
    score = (forward.score + reverse.score) / 2;
  }

  return {
    score,
    forwardScore: forward.score,
    reverseScore: reverse.score,
    forwardMatches: forward.matches,
    reverseMatches: reverse.matches,
    sharedGoals,
  };
}
