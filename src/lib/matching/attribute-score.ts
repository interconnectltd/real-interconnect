/**
 * 属性ベーススコア計算 (コールドスタート用)
 * ARCHITECTURE.md セクション 2.5
 */

// ── 業種隣接マップ ──

const ADJACENCY: Record<string, Record<string, number>> = {
  "IT・テクノロジー": {
    "コンサルティング": 0.7, "マーケティング・広告": 0.6,
    "金融・保険": 0.5, "メディア・エンタメ": 0.5, "小売・EC": 0.5,
  },
  "コンサルティング": {
    "IT・テクノロジー": 0.7, "金融・保険": 0.6, "人材・HR": 0.5,
  },
  "金融・保険": {
    "コンサルティング": 0.6, "IT・テクノロジー": 0.5, "不動産": 0.5, "法律": 0.5,
  },
  "製造業": {
    "物流・運輸": 0.6, "建設": 0.5, "エネルギー": 0.5,
  },
  "不動産": {
    "建設": 0.7, "金融・保険": 0.5,
  },
  "医療・ヘルスケア": {
    "教育": 0.4,
  },
  "教育": {
    "人材・HR": 0.5, "医療・ヘルスケア": 0.4,
  },
  "マーケティング・広告": {
    "メディア・エンタメ": 0.7, "小売・EC": 0.6, "IT・テクノロジー": 0.6,
  },
  "人材・HR": {
    "コンサルティング": 0.5, "教育": 0.5,
  },
  "小売・EC": {
    "物流・運輸": 0.6, "マーケティング・広告": 0.6, "IT・テクノロジー": 0.5,
  },
  "メディア・エンタメ": {
    "マーケティング・広告": 0.7, "IT・テクノロジー": 0.5,
  },
  "法律": {
    "金融・保険": 0.5,
  },
  "建設": {
    "不動産": 0.7, "製造業": 0.5,
  },
  "物流・運輸": {
    "製造業": 0.6, "小売・EC": 0.6,
  },
};

export function industryAffinity(a: string | null, b: string | null): number {
  if (!a || !b) return 0.2;
  if (a === b) return 1.0;
  if (a === "その他" || b === "その他") return 0.25;
  return ADJACENCY[a]?.[b] ?? ADJACENCY[b]?.[a] ?? 0.15;
}

// ── 職種補完性 ──

const ROLE_PATTERNS: [RegExp, string][] = [
  [/ceo|代表|社長|founder|共同創業/i, "executive"],
  [/cto|vp\s*eng|技術(責任|部長|取締)|テック/i, "tech_leader"],
  [/cfo|財務|経理/i, "finance_leader"],
  [/coo|事業(責任|部長)|運営/i, "ops_leader"],
  [/営業|セールス|sales|bd|ビジネス(開発|デベ)/i, "sales"],
  [/エンジニア|engineer|開発(者)?|developer|プログラマ/i, "engineer"],
  [/デザイナ|designer|ux|ui/i, "designer"],
  [/pm|プロダクト(マネ|責任)|product\s*manag/i, "product"],
  [/マーケ|market|広報|pr/i, "marketing"],
  [/人事|hr|採用|リクルート/i, "hr"],
  [/法務|legal|コンプライアンス/i, "legal"],
  [/投資|vc|キャピタル|investor/i, "investor"],
  [/コンサル|consult|アドバイザ/i, "consultant"],
  [/マネージャ|部長|リーダー|manager|lead/i, "manager"],
];

const COMPLEMENT_MATRIX: Record<string, Record<string, number>> = {
  tech_leader: { sales: 1.0, product: 0.9, engineer: 0.85, marketing: 0.8, investor: 0.9, designer: 0.7, tech_leader: 0.6 },
  executive: { investor: 1.0, sales: 0.8, consultant: 0.8, tech_leader: 0.7, executive: 0.5 },
  sales: { tech_leader: 1.0, product: 0.8, marketing: 0.7, consultant: 0.6, sales: 0.6 },
  engineer: { product: 0.9, designer: 0.9, tech_leader: 0.85, engineer: 0.6, marketing: 0.5 },
  designer: { engineer: 0.9, product: 0.8, marketing: 0.7, tech_leader: 0.7, designer: 0.5 },
  product: { engineer: 0.9, designer: 0.8, sales: 0.8, tech_leader: 0.8, marketing: 0.7, product: 0.6 },
  marketing: { sales: 0.7, product: 0.7, designer: 0.6, engineer: 0.5, marketing: 0.5 },
  investor: { executive: 1.0, tech_leader: 0.9, product: 0.7 },
  consultant: { executive: 0.8, ops_leader: 0.7, tech_leader: 0.6, sales: 0.6 },
  hr: { executive: 0.7, manager: 0.7, consultant: 0.6, hr: 0.5 },
  finance_leader: { executive: 0.8, investor: 0.8, consultant: 0.6, finance_leader: 0.5 },
  manager: { engineer: 0.7, product: 0.7, hr: 0.7, manager: 0.5 },
};

function classifyRole(position: string | null): string {
  if (!position) return "unknown";
  const lower = position.toLowerCase();
  for (const [pattern, role] of ROLE_PATTERNS) {
    if (pattern.test(lower)) return role;
  }
  return "unknown";
}

export function roleComplement(a: string | null, b: string | null): number {
  const roleA = classifyRole(a);
  const roleB = classifyRole(b);
  if (roleA === "unknown" || roleB === "unknown") return 0.3;
  return COMPLEMENT_MATRIX[roleA]?.[roleB]
      ?? COMPLEMENT_MATRIX[roleB]?.[roleA]
      ?? 0.3;
}

// ── bio キーワード辞書 ──

const BIO_KEYWORDS: Record<string, string[]> = {
  startup: ["スタートアップ", "起業", "創業", "ベンチャー", "PMF", "シード"],
  ai_ml: ["AI", "機械学習", "LLM", "生成AI", "ディープラーニング", "自然言語処理"],
  saas: ["SaaS", "B2B", "ARR", "サブスクリプション", "MRR"],
  dx: ["DX", "デジタル変革", "自動化", "RPA", "デジタルトランスフォーメーション"],
  global: ["海外", "グローバル", "越境", "海外展開", "英語"],
  investment: ["資金調達", "出資", "IPO", "M&A", "投資", "ファンド"],
  growth: ["グロース", "成長戦略", "スケール", "PMF", "ユーザー獲得"],
  product: ["プロダクト", "ユーザー体験", "UX", "UI", "デザイン思考"],
  data: ["データ", "分析", "BI", "KPI", "アナリティクス"],
  hr_org: ["組織", "チーム", "マネジメント", "育成", "評価制度", "カルチャー"],
  marketing: ["マーケティング", "ブランド", "コンテンツ", "SEO", "広告"],
  sales_biz: ["営業", "顧客", "商談", "パートナー", "アライアンス"],
};

function extractBioTags(bio: string | null): Set<string> {
  if (!bio) return new Set();
  const tags = new Set<string>();
  for (const [tag, keywords] of Object.entries(BIO_KEYWORDS)) {
    for (const kw of keywords) {
      if (bio.includes(kw)) {
        tags.add(tag);
        break;
      }
    }
  }
  return tags;
}

export function bioKeywordOverlap(a: string | null, b: string | null): number {
  const tagsA = extractBioTags(a);
  const tagsB = extractBioTags(b);
  if (tagsA.size === 0 && tagsB.size === 0) return 0.2;
  if (tagsA.size === 0 || tagsB.size === 0) return 0.15;
  const intersection = [...tagsA].filter((t) => tagsB.has(t)).length;
  const union = new Set([...tagsA, ...tagsB]).size;
  return union > 0 ? intersection / union : 0.15;
}

// ── 統合 ──

export interface AttributeScoreResult {
  valueFit: number;
  relationalQuality: number;
}

export function calcAttributeScore(
  viewer: { industry?: string | null; position?: string | null; bio?: string | null },
  target: { industry?: string | null; position?: string | null; bio?: string | null },
): AttributeScoreResult {
  const hasBio = !!viewer.bio && !!target.bio;
  const [wI, wR, wB] = hasBio ? [0.35, 0.35, 0.30] : [0.50, 0.50, 0.0];

  const ind = industryAffinity(viewer.industry ?? null, target.industry ?? null);
  const role = roleComplement(viewer.position ?? null, target.position ?? null);
  const bio = hasBio ? bioKeywordOverlap(viewer.bio ?? null, target.bio ?? null) : 0;

  return {
    valueFit: wI * ind + wR * role + wB * bio,
    relationalQuality: 0.50, // 属性のみでは中立
  };
}
