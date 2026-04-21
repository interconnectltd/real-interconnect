export const INDUSTRIES = [
  "IT・テクノロジー",
  "コンサルティング",
  "金融・保険",
  "製造業",
  "不動産",
  "医療・ヘルスケア",
  "教育",
  "マーケティング・広告",
  "人材・HR",
  "小売・EC",
  "エネルギー",
  "メディア・エンタメ",
  "法律",
  "建設",
  "物流・運輸",
  "その他",
] as const;

export const POSITIONS = [
  "代表取締役",
  "取締役",
  "執行役員",
  "部長",
  "マネージャー",
  "リーダー",
  "エンジニア",
  "デザイナー",
  "コンサルタント",
  "フリーランス",
] as const;

export const MEMBER_SORT_OPTIONS = [
  { value: "score", label: "おすすめ順" },
  { value: "newest", label: "新着順" },
  { value: "name", label: "名前順" },
] as const;

export type MemberSortBy = (typeof MEMBER_SORT_OPTIONS)[number]["value"];

export const MATCHING_WEIGHTS = {
  value_fit: 0.60,
  relational_quality: 0.40,
} as const;

export const SCORE_AXIS_LABELS: Record<string, string> = {
  value_fit: "価値適合度",
  relational_quality: "関係性の質",
};

export const MATCHING_MUTUAL_THRESHOLD = 0.70;

// ── Goals/Offerings 6カテゴリ ──

export const GOAL_TYPES = [
  { value: "partnership", label: "事業提携", description: "事業パートナーを探している" },
  { value: "consulting", label: "経営相談", description: "経営課題を相談したい" },
  { value: "investment", label: "投資", description: "資金調達または投資先を探している" },
  { value: "recruitment", label: "採用", description: "人材を探している" },
  { value: "information", label: "情報交換", description: "業界の最新情報を交換したい" },
  { value: "mentoring", label: "メンタリング", description: "メンターを探している、またはメンターになりたい" },
] as const;

export type GoalType = (typeof GOAL_TYPES)[number]["value"];

// ── 成熟度モデル (設計書 1-08) ──

export const MATURITY_WEIGHTS = {
  1: { attribute: 0.70, purpose: 0.20, conversation: 0.00, history: 0.10 },
  2: { attribute: 0.25, purpose: 0.20, conversation: 0.40, history: 0.15 },
  3: { attribute: 0.10, purpose: 0.15, conversation: 0.45, history: 0.30 },
} as const;

export const NOTIFICATION_ACTION_WHITELIST = new Set([
  "accept",
  "reject",
  "view_profile",
  "view_matching",
]);

/** Score label thresholds */
export function scoreLabel(score: number): string {
  if (score >= 0.70) return "高い";
  if (score >= 0.40) return "中程度";
  return "これから";
}
