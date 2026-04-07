/**
 * おすすめ理由テンプレートエンジン
 * ARCHITECTURE.md セクション 3
 */

// ── 型 ──

export interface ReasonContext {
  viewer: { industry?: string | null; position?: string | null; bio?: string | null };
  target: {
    id: string;
    name?: string | null;
    industry?: string | null;
    position?: string | null;
    bio?: string | null;
    company?: string | null;
  };
  valueFit: number;
  relationalQuality: number;
  confidence: number;
  sharedMeetingCount: number;
  // カテゴリタグマッチ結果 (AI分析後)
  matchedNeeds?: string[];
  matchedSkills?: string[];
  matchedOfferings?: string[];
  // Goals×Offerings 交差マッチ
  purposeForwardMatches?: string[];  // viewer のgoalに対するtargetのofferingマッチラベル
  purposeReverseMatches?: string[];  // target のgoalに対するviewerのofferingマッチラベル
  purposeSharedGoals?: string[];     // 共通のgoalラベル
  // バッチ内重複抑制
  usedTemplateIds: Set<string>;
}

interface Template {
  id: string;
  tier: 1 | 2 | 3 | 4;
  match: (ctx: ReasonContext) => boolean;
  text: (ctx: ReasonContext) => string;
  priority: (ctx: ReasonContext) => number;
}

// ── bio キーワード抽出 ──

const STOP_WORDS = new Set(["の", "は", "が", "を", "に", "で", "と", "です", "ます", "する", "こと", "ため", "から", "まで", "として"]);

function bioKeywords(bio: string | null): string[] {
  if (!bio) return [];
  return bio
    .split(/[\s、。！？,./\n]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function overlapKeywords(a: string | null, b: string | null): string[] {
  const setA = new Set(bioKeywords(a));
  return bioKeywords(b).filter((w) => setA.has(w));
}

// ── テンプレート定義 (22件) ──

const TEMPLATES: Template[] = [
  // Tier 1: 属性ベース (priority 8-30)
  { id: "a01", tier: 1,
    match: (c) => !!c.target.industry && c.viewer.industry === c.target.industry,
    text: (c) => `${c.target.industry}で活躍されている方です`,
    priority: () => 30 },
  { id: "a02", tier: 1,
    match: (c) => !!c.target.industry && c.viewer.industry !== c.target.industry,
    text: (c) => `${c.target.industry}の知見を持つ方。異業種の視点が得られそうです`,
    priority: () => 28 },
  { id: "a03", tier: 1,
    match: (c) => !!c.viewer.position && !!c.target.position && c.viewer.position === c.target.position,
    text: (c) => `同じ${c.target.position}のポジション。共通の悩みを話し合えるかもしれません`,
    priority: () => 25 },
  { id: "a04", tier: 1,
    match: (c) => !!c.target.position && c.viewer.position !== c.target.position,
    text: (c) => `${c.target.position}として活動中。あなたの仕事と補い合える関係です`,
    priority: () => 20 },
  { id: "a05", tier: 1,
    match: (c) => overlapKeywords(c.viewer.bio ?? null, c.target.bio ?? null).length > 0,
    text: (c) => {
      const kw = overlapKeywords(c.viewer.bio ?? null, c.target.bio ?? null)[0];
      return `プロフィールに「${kw}」という共通テーマがあります`;
    },
    priority: (c) => 22 + overlapKeywords(c.viewer.bio ?? null, c.target.bio ?? null).length },
  { id: "a06", tier: 1,
    match: (c) => !!c.target.company,
    text: (c) => `${c.target.company}での経験をお持ちの方です`,
    priority: () => 10 },
  { id: "a07", tier: 1,
    match: (c) => !!c.target.bio && c.target.bio.length >= 30,
    text: () => "幅広い経歴をお持ちの方。新たな視点が得られそうです",
    priority: () => 8 },

  // Tier 1.5: Goals×Offerings 交差 (priority 40-55) — マッチングの核心
  // 設計書 1-09: 「佐藤さんはSaaS CTOで、あなたと同じ事業提携を求めています」
  { id: "g01", tier: 1,
    match: (c) => (c.purposeForwardMatches?.length ?? 0) > 0,
    text: (c) => {
      const name = c.target.name ?? "この方";
      const role = c.target.position ? `${c.target.position}の` : "";
      return `${name}さんは${role}${c.purposeForwardMatches![0]}に応えられる方です`;
    },
    priority: () => 55 },
  { id: "g02", tier: 1,
    match: (c) => (c.purposeReverseMatches?.length ?? 0) > 0,
    text: (c) => {
      const name = c.target.name ?? "この方";
      return `${name}さんも${c.purposeReverseMatches![0]}を求めています。あなたの経験が力になりそうです`;
    },
    priority: () => 50 },
  { id: "g03", tier: 1,
    match: (c) => (c.purposeSharedGoals?.length ?? 0) > 0,
    text: (c) => {
      const name = c.target.name ?? "この方";
      const industry = c.target.industry ? `${c.target.industry}の` : "";
      return `${name}さんは${industry}あなたと同じ「${c.purposeSharedGoals![0]}」を求めています`;
    },
    priority: () => 45 },
  { id: "g04", tier: 1,
    match: (c) => (c.purposeForwardMatches?.length ?? 0) >= 2,
    text: (c) => `${c.purposeForwardMatches![0]}と${c.purposeForwardMatches![1]}の両面でつながれる相手です`,
    priority: () => 52 },

  // Tier 2: カテゴリマッチ (priority 32-60)
  { id: "c01", tier: 2,
    match: (c) => (c.matchedNeeds?.length ?? 0) > 0,
    text: (c) => `あなたが求めている「${c.matchedNeeds![0]}」に関連するスキルをお持ちです`,
    priority: () => 60 },
  { id: "c02", tier: 2,
    match: (c) => (c.matchedOfferings?.length ?? 0) > 0,
    text: (c) => `「${c.matchedOfferings![0]}」を提供できる方。あなたの活動の力になりそうです`,
    priority: () => 50 },
  { id: "c03", tier: 2,
    match: (c) => (c.matchedSkills?.length ?? 0) > 0,
    text: (c) => `「${c.matchedSkills![0]}」という共通の得意分野があります。話が弾みそうです`,
    priority: () => 48 },
  { id: "c04", tier: 2,
    match: (c) => c.confidence >= 0.3,
    text: () => "多彩なスキルセットの持ち主。意外なコラボの可能性を秘めています",
    priority: () => 35 },
  { id: "c05", tier: 2,
    match: (c) => c.confidence >= 0.28,
    text: () => "コミュニティで積極的に活動されている方です",
    priority: () => 32 },

  // Tier 3: AI 2軸 (priority 52-80)
  { id: "ai01", tier: 3,
    match: (c) => c.confidence >= 0.3 && c.valueFit >= 0.70,
    text: () => "あなたのニーズと相手の強みが高い確度で一致しています",
    priority: (c) => 70 + c.valueFit * 10 },
  { id: "ai02", tier: 3,
    match: (c) => c.confidence >= 0.3 && c.valueFit >= 0.60,
    text: () => "スキルの組み合わせに相乗効果がありそうです",
    priority: (c) => 62 + c.valueFit * 8 },
  { id: "ai03", tier: 3,
    match: (c) => c.confidence >= 0.3 && c.relationalQuality >= 0.70,
    text: () => "コミュニケーションのスタイルが近く、打ち解けやすい相手です",
    priority: (c) => 65 + c.relationalQuality * 10 },
  { id: "ai04", tier: 3,
    match: (c) => c.confidence >= 0.3 && (c.matchedNeeds?.length ?? 0) > 0 && (c.matchedOfferings?.length ?? 0) > 0,
    text: (c) => `あなたの課題「${c.matchedNeeds![0]}」に対して「${c.matchedOfferings![0]}」という解決策を持つ方です`,
    priority: () => 75 },
  { id: "ai05", tier: 3,
    match: (c) => c.confidence >= 0.3 && c.relationalQuality >= 0.60,
    text: () => "会話の深まりが期待できる組み合わせです",
    priority: () => 55 },
  { id: "ai06", tier: 3,
    match: (c) => c.confidence >= 0.3 && c.valueFit >= 0.50 && c.relationalQuality >= 0.50,
    text: () => "ニーズとスキルの双方でバランスよく噛み合っています",
    priority: () => 52 },

  // Tier 4: 関係性実績 (priority 78-95)
  { id: "r01", tier: 4,
    match: (c) => c.sharedMeetingCount >= 3,
    text: (c) => `${c.sharedMeetingCount}回の会議を通じて、深い信頼関係が築かれています`,
    priority: (c) => 90 + c.sharedMeetingCount },
  { id: "r02", tier: 4,
    match: (c) => c.sharedMeetingCount >= 1,
    text: () => "過去に同じ場で話した経験があり、次の対話がさらに実りあるものに",
    priority: () => 80 },
  { id: "r03", tier: 4,
    match: (c) => c.relationalQuality >= 0.60 && c.sharedMeetingCount >= 1,
    text: () => "これまでの交流パターンから、相性の良さがうかがえます",
    priority: () => 78 },
  { id: "r04", tier: 4,
    match: (c) => c.relationalQuality >= 0.80 && c.sharedMeetingCount >= 2,
    text: () => "会話のテンポが合う方。議論が自然に深まる関係です",
    priority: () => 85 },
];

// ── フォールバック ──

const FALLBACKS = [
  "コミュニティの新しいつながりとして、一度お話ししてみませんか",
  "異なるバックグラウンドの方との出会いが、新たな発見につながります",
  "まだお話しされたことのない方です。共通点が見つかるかもしれません",
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── メイン ──

const MAX_REASONS = 3;
const MAX_SAME_TEMPLATE_IN_BATCH = 3;

export function generateReasons(ctx: ReasonContext): string[] {
  const candidates = TEMPLATES
    .filter((t) => t.match(ctx))
    .sort((a, b) => b.priority(ctx) - a.priority(ctx));

  const selected: string[] = [];
  const usedIds: string[] = [];

  for (const tmpl of candidates) {
    if (selected.length >= MAX_REASONS) break;

    // バッチ内重複抑制
    const batchCount = [...ctx.usedTemplateIds].filter((id) => id === tmpl.id).length;
    if (batchCount >= MAX_SAME_TEMPLATE_IN_BATCH) continue;

    const rendered = tmpl.text(ctx);

    // 同一文面排除
    if (selected.includes(rendered)) continue;

    selected.push(rendered);
    usedIds.push(tmpl.id);
  }

  // フォールバック
  if (selected.length === 0) {
    const idx = hashCode(ctx.target.id) % FALLBACKS.length;
    selected.push(FALLBACKS[idx]!);
  }

  // バッチ追跡に記録
  for (const id of usedIds) {
    ctx.usedTemplateIds.add(id);
  }

  return selected;
}

export function generateReasonsForBatch(
  viewer: ReasonContext["viewer"],
  targets: {
    target: ReasonContext["target"];
    valueFit: number;
    relationalQuality: number;
    confidence: number;
    sharedMeetingCount: number;
    matchedNeeds?: string[];
    matchedSkills?: string[];
    matchedOfferings?: string[];
  }[],
): Map<string, string[]> {
  const usedTemplateIds = new Set<string>();
  const result = new Map<string, string[]>();

  for (const t of targets) {
    const reasons = generateReasons({
      viewer,
      ...t,
      usedTemplateIds,
    });
    result.set(t.target.id, reasons);
  }

  return result;
}
