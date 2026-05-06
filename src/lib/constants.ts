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

// ── Goals/Offerings カテゴリ taxonomy ──

/**
 * Goals (求めていること) と Offerings (提供できること) の共通カテゴリ。
 * goal/offering それぞれで説明文を持つ。
 *
 * 改訂履歴:
 *   - 2026-05-04: 投資は seek/offer 分離、専門家紹介・補助金・M&A・海外 を独立化
 *   - 2026-05-06: information (業界情報・知見交換) を削除 — シグナルが弱く matching
 *     ノイズになるため。expertise_pro を business 群へ移動 (人脈紹介シグナル)。
 *     mentoring を「継続契約」consulting を「単発相談」と差別化。
 *     片側 description が空 ("") のものは UI 側で非表示。
 *
 * グルーピング: business / capital / operations / expertise
 */
export type GoalGroup = "business" | "capital" | "operations" | "expertise";

export const GOAL_TYPES = [
  // === 営業・事業 (business) ===
  { value: "client_intro",     group: "business" as GoalGroup, label: "顧客紹介・リード獲得",
    seekDescription: "新規顧客・案件のリードを紹介してほしい",
    offerDescription: "自社の顧客接点を活かしリード・案件を紹介できる" },
  { value: "partnership",      group: "business" as GoalGroup, label: "事業提携・アライアンス",
    seekDescription: "事業提携・アライアンス可能な企業を探している",
    offerDescription: "事業提携・協業・共同事業に応じられる" },
  { value: "sales_support",    group: "business" as GoalGroup, label: "営業支援・販路拡大",
    seekDescription: "営業代行・販路開拓パートナーを探している",
    offerDescription: "販路・営業チャネル・代理店網を提供できる" },
  { value: "international",    group: "business" as GoalGroup, label: "海外展開",
    seekDescription: "海外進出パートナー・現地ネットワークを探している",
    offerDescription: "海外現地ネットワーク・進出支援を提供できる" },
  { value: "m_and_a",          group: "business" as GoalGroup, label: "M&A",
    seekDescription: "買収候補・売却候補となる企業を探している",
    offerDescription: "M&A仲介・買収/売却案件のソーシングが可能" },
  { value: "expertise_pro",    group: "business" as GoalGroup, label: "専門家紹介",
    seekDescription: "信頼できる弁護士・税理士・社労士・行政書士等を紹介してほしい",
    offerDescription: "士業・専門家ネットワークから適任者を紹介できる" },

  // === 資本 (capital) ===
  // 投資は seek/offer を完全分離。片方しか意味を持たないので反対側は "" にして UI 非表示。
  { value: "investment_seek",  group: "capital" as GoalGroup, label: "資金調達",
    seekDescription: "投資家・VCからの出資を求めている",
    offerDescription: "" },
  { value: "investment_offer", group: "capital" as GoalGroup, label: "投資・出資",
    seekDescription: "",
    offerDescription: "投資先を探している。出資が可能" },
  { value: "subsidy",          group: "capital" as GoalGroup, label: "補助金・助成金",
    seekDescription: "活用可能な補助金を探している",
    offerDescription: "補助金・助成金の申請支援が可能 (採択実績あり)" },

  // === 運営 (operations) ===
  { value: "recruitment",      group: "operations" as GoalGroup, label: "採用・人材",
    seekDescription: "人材を採用したい",
    offerDescription: "候補者を紹介できる" },
  { value: "outsourcing_seek", group: "operations" as GoalGroup, label: "業務委託",
    seekDescription: "業務委託・アウトソース先を探している",
    offerDescription: "業務受託・専門サービスを提供できる" },
  { value: "dx_systemize",     group: "operations" as GoalGroup, label: "DX・システム導入",
    seekDescription: "DX・システム導入・SaaS選定の支援を探している",
    offerDescription: "DX推進・システム導入・SaaS実装が可能" },
  { value: "marketing_pr",     group: "operations" as GoalGroup, label: "マーケティング・PR",
    seekDescription: "マーケティング・PR・広報の実行支援を探している",
    offerDescription: "マーケ施策・PR・広報の実行が可能" },

  // === 専門知識 (expertise) ===
  { value: "consulting",       group: "expertise" as GoalGroup, label: "経営相談",
    seekDescription: "経営課題について単発で相談したい",
    offerDescription: "経営課題への単発アドバイス・スポット相談に応じられる" },
  { value: "mentoring",        group: "expertise" as GoalGroup, label: "メンタリング (継続)",
    seekDescription: "継続的・定期的にアドバイザー契約してくれるメンターを探している",
    offerDescription: "継続的・定期的なアドバイザー契約として伴走支援できる (顧問契約・月次1on1等)" },
] as const;

// emoji フィールドは UI からノイズなので削除。group の視覚識別は label のみで行う。
export const GOAL_GROUPS: { value: GoalGroup; label: string }[] = [
  { value: "business",   label: "営業・事業" },
  { value: "capital",    label: "資本" },
  { value: "operations", label: "運営" },
  { value: "expertise",  label: "専門知識" },
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
