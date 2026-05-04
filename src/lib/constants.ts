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

export const MATCHING_MUTUAL_THRESHOLD = 0.70;

// ── Goals/Offerings 6カテゴリ ──

/**
 * Goals (求めていること) と Offerings (提供できること) の共通カテゴリ taxonomy。
 * goal/offering それぞれで別の説明文を持つ (旧仕様は同一文をコピペしていてバグだった)。
 *
 * カテゴリ設計方針:
 *   - 商談で頻出する具体的な要望/価値提供を網羅 (旧6種は曖昧で精度低下の原因)
 *   - 投資は seek (調達) / offer (出資) を分離
 *   - 客紹介 / 業務委託 / 専門家紹介 / DX / PR / 営業 / 補助金 / M&A / 海外 を新設
 *   - グルーピング: business / capital / operations / expertise
 */
export type GoalGroup = "business" | "capital" | "operations" | "expertise";

export const GOAL_TYPES = [
  // === 営業・事業 (business) ===
  { value: "client_intro",     group: "business" as GoalGroup, label: "顧客紹介・リード獲得",
    seekDescription: "新規顧客や案件を紹介してほしい",
    offerDescription: "自分の顧客・案件を紹介できる" },
  { value: "partnership",      group: "business" as GoalGroup, label: "事業提携・アライアンス",
    seekDescription: "事業提携できる相手を探している",
    offerDescription: "提携・協業に応じられる" },
  { value: "sales_support",    group: "business" as GoalGroup, label: "営業支援・販路拡大",
    seekDescription: "営業代行・販路を探している",
    offerDescription: "営業代行・販路を提供できる" },
  { value: "m_and_a",          group: "business" as GoalGroup, label: "M&A",
    seekDescription: "買収先・売却先・M&A情報を探している",
    offerDescription: "M&A仲介・案件提供が可能" },
  { value: "international",    group: "business" as GoalGroup, label: "海外展開",
    seekDescription: "海外パートナー・進出支援を探している",
    offerDescription: "海外ネットワーク・進出支援を提供できる" },

  // === 資本 (capital) ===
  { value: "investment_seek",  group: "capital" as GoalGroup, label: "資金調達",
    seekDescription: "投資家・VCからの出資を求めている",
    offerDescription: "(該当なし - 投資家紹介は「専門家紹介」を選択)" },
  { value: "investment_offer", group: "capital" as GoalGroup, label: "投資・出資",
    seekDescription: "(該当なし - 出資を受けたい場合は「資金調達」を選択)",
    offerDescription: "投資先を探している。出資が可能" },
  { value: "subsidy",          group: "capital" as GoalGroup, label: "補助金・助成金",
    seekDescription: "活用可能な補助金を探している",
    offerDescription: "補助金獲得支援が可能" },

  // === 運営 (operations) ===
  { value: "recruitment",      group: "operations" as GoalGroup, label: "採用・人材",
    seekDescription: "人材を採用したい",
    offerDescription: "候補者を紹介できる" },
  { value: "outsourcing_seek", group: "operations" as GoalGroup, label: "業務委託",
    seekDescription: "業務委託先を探している",
    offerDescription: "業務受託が可能" },
  { value: "dx_systemize",     group: "operations" as GoalGroup, label: "DX・システム導入",
    seekDescription: "DX/システム導入支援を探している",
    offerDescription: "DX/SaaS導入支援が可能" },
  { value: "marketing_pr",     group: "operations" as GoalGroup, label: "マーケティング・PR",
    seekDescription: "マーケ/PR支援を探している",
    offerDescription: "マーケ/PR実行が可能" },

  // === 専門知識 (expertise) ===
  { value: "consulting",       group: "expertise" as GoalGroup, label: "経営相談",
    seekDescription: "経営課題を相談したい",
    offerDescription: "経営アドバイスを提供できる" },
  { value: "mentoring",        group: "expertise" as GoalGroup, label: "メンタリング",
    seekDescription: "メンター・アドバイザーを探している",
    offerDescription: "メンター・アドバイザーになれる" },
  { value: "expertise_pro",    group: "expertise" as GoalGroup, label: "専門家紹介",
    seekDescription: "弁護士・税理士・行政書士等の専門家を探している",
    offerDescription: "専門家ネットワークを提供できる" },
  { value: "information",      group: "expertise" as GoalGroup, label: "業界情報・知見交換",
    seekDescription: "業界の最新情報・知見を得たい",
    offerDescription: "業界知見を共有できる" },
] as const;

export const GOAL_GROUPS: { value: GoalGroup; label: string; emoji: string }[] = [
  { value: "business",   label: "営業・事業",   emoji: "🤝" },
  { value: "capital",    label: "資本",        emoji: "💰" },
  { value: "operations", label: "運営",        emoji: "⚙️" },
  { value: "expertise",  label: "専門知識",     emoji: "🎓" },
];

// V2: 重みは scoring_config テーブルで管理（MATURITY_WEIGHTS は削除済み）

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
