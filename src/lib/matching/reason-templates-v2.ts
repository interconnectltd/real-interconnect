/**
 * 推薦理由 V2 テンプレート
 * SCORING_V2_ARCHITECTURE.md §7 — ターゲット視点のみ、viewerニーズ非明示
 */

interface ReasonCtx {
  target: {
    name?: string | null;
    industry?: string | null;
    position?: string | null;
    company?: string | null;
  };
  needOfferScore: number;
  reverseMatch: number;
  expertiseFit: number;
  topicAlignment: number;
  engagementValue: number;
  confidence: number;
  sharedMeetingCount: number;
  // ベクトルからのテキスト情報
  topOfferText?: string;
  topNeedCategory?: string;
  topTopicText?: string;
}

interface ReasonTemplate {
  id: string;
  tier: number;
  match: (c: ReasonCtx) => boolean;
  text: (c: ReasonCtx) => string;
  priority: (c: ReasonCtx) => number;
}

const name = (c: ReasonCtx) => c.target.name ?? "この方";

const TEMPLATES: ReasonTemplate[] = [
  // === Tier 4: 関係（最高優先度） ===
  {
    id: "r01", tier: 4,
    match: (c) => c.sharedMeetingCount >= 3,
    text: (c) => `${name(c)}さんとは${c.sharedMeetingCount}回の会議を通じて深い信頼関係が築かれています`,
    priority: (c) => 90 + c.sharedMeetingCount,
  },
  {
    id: "r02", tier: 4,
    match: (c) => c.sharedMeetingCount >= 1,
    text: (c) => `${name(c)}さんとは以前お話しされた実績があります`,
    priority: () => 80,
  },

  // === Tier 3: AI高スコア ===
  {
    id: "ai01", tier: 3,
    match: (c) => c.needOfferScore >= 0.70 && c.confidence >= 0.4,
    text: (c) => {
      const offer = c.topOfferText ? `「${c.topOfferText.slice(0, 30)}」の` : "";
      return `${name(c)}さんは${offer}実績をお持ちで、お力になれる可能性が高い方です`;
    },
    priority: (c) => 75 + c.needOfferScore * 10,
  },
  {
    id: "ai02", tier: 3,
    match: (c) => c.reverseMatch >= 0.60 && c.confidence >= 0.3,
    text: (c) => `${name(c)}さんも類似の課題をお持ちで、お互いに力になれる関係です`,
    priority: (c) => 70 + c.reverseMatch * 10,
  },
  {
    id: "ai03", tier: 3,
    match: (c) => c.needOfferScore >= 0.50 && c.confidence >= 0.3,
    text: (c) => {
      const offer = c.topOfferText ? `「${c.topOfferText.slice(0, 30)}」の` : "";
      return `${name(c)}さんは${offer}経験をお持ちです`;
    },
    priority: (c) => 62 + c.needOfferScore * 10,
  },

  // === Tier 2: 会話（新規5種、ターゲット視点） ===
  {
    id: "c01_v2", tier: 2,
    match: (c) => c.expertiseFit >= 0.60,
    text: (c) => {
      const pos = c.target.position ? `${c.target.position}として` : "";
      return `${name(c)}さんは${pos}深い専門知識をお持ちです`;
    },
    priority: (c) => 55 + c.expertiseFit * 10,
  },
  {
    id: "c02_v2", tier: 2,
    match: (c) => c.engagementValue >= 0.60,
    text: (c) => `${name(c)}さんはミーティングで具体的なアドバイスやサポートを提供してくれる方です`,
    priority: (c) => 58 + c.engagementValue * 8,
  },
  {
    id: "c03_v2", tier: 2,
    match: (c) => c.topicAlignment >= 0.50,
    text: (c) => {
      const topic = c.topTopicText ? `「${c.topTopicText.slice(0, 20)}」` : "共通のテーマ";
      return `${topic}について深い知見をお持ちです`;
    },
    priority: (c) => 50 + c.topicAlignment * 10,
  },
  {
    id: "c04_v2", tier: 2,
    match: (c) => c.engagementValue >= 0.50 && c.expertiseFit >= 0.40,
    text: (c) => `${name(c)}さんとの対話を通じて新しい視点が得られそうです`,
    priority: () => 48,
  },
  {
    id: "c05_v2", tier: 2,
    match: (c) => c.reverseMatch >= 0.40,
    text: (c) => `${name(c)}さんとは互いの強みを活かし合える可能性があります`,
    priority: (c) => 45 + c.reverseMatch * 8,
  },

  // === Tier 1: 属性（フォールバック） ===
  {
    id: "a01", tier: 1,
    match: (c) => !!c.target.industry,
    text: (c) => `${c.target.industry}で活躍されている方です`,
    priority: () => 30,
  },
  {
    id: "a02", tier: 1,
    match: (c) => !!c.target.company,
    text: (c) => `${c.target.company}で${c.target.position ?? "ご活躍"}の方です`,
    priority: () => 25,
  },
  {
    id: "a03", tier: 1,
    match: () => true,
    text: (c) => `コミュニティの新しいつながりとして、一度お話ししてみませんか`,
    priority: () => 5,
  },
];

export function generateReasonsV2(ctx: ReasonCtx): string[] {
  const candidates = TEMPLATES
    .filter((t) => t.match(ctx))
    .sort((a, b) => b.priority(ctx) - a.priority(ctx));

  const selected: string[] = [];
  const usedTiers = new Map<number, number>();

  for (const tmpl of candidates) {
    if (selected.length >= 3) break;
    // 同じTierから最大2件
    const tierCount = usedTiers.get(tmpl.tier) ?? 0;
    if (tierCount >= 2) continue;

    const text = tmpl.text(ctx);
    if (selected.includes(text)) continue;

    selected.push(text);
    usedTiers.set(tmpl.tier, tierCount + 1);
  }

  if (selected.length === 0) {
    selected.push("コミュニティの新しいつながりとして、一度お話ししてみませんか");
  }

  return selected;
}
