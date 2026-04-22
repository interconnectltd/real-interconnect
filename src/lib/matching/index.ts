// V2 スコアリングモジュール
// V1 (score-compute.ts, reason-templates.ts) は削除済み — Step 6 完了
export { computeScoreV2, type ScoreV2Input, type ScoreV2Result, type ScoringConfig } from "./score-compute-v2";
export { calcAttributeScore } from "./attribute-score";
export { calcPurposeScore, type PurposeScoreResult } from "./purpose-score";
export { generateReasonsV2 } from "./reason-templates-v2";
