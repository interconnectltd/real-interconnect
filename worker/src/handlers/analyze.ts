/**
 * analyze ハンドラ V2: Claude Opus 4.6 で transcript を v3.0.0 構造化抽出
 * SCORING_V2_ARCHITECTURE.md §1 — Opus構造化抽出（レイヤー1）
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { supabase, enqueueJob } from "../queue";

const anthropic = new Anthropic({
  apiKey: process.env.AI_API_KEY!,
});

// --- Zod バリデーション（worker 内にインライン定義、パスエイリアス不要） ---
const CATEGORIES = [
  "sales", "marketing", "technology", "finance", "hr", "legal",
  "operations", "strategy", "design", "industry", "leadership", "other",
] as const;

const needSchema = z.object({
  text: z.string(),
  explicit: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.7),
  evidence: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
  solver_profile: z.string().min(5).max(500).default(""),
  urgency_signals: z.array(z.string()).default([]),
  category: z.enum(CATEGORIES).default("other"),
  subcategory: z.string().default("other"),
});

const offerSchema = z.object({
  text: z.string(),
  explicit: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.7),
  evidence: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
  beneficiary_profile: z.string().min(5).max(500).default(""),
  credibility: z.enum(["実績", "自己申告", "推論"]).default("推論"),
  category: z.enum(CATEGORIES).default("other"),
  subcategory: z.string().default("other"),
});

const opusOutputSchema = z.object({
  needs: z.array(needSchema).default([]),
  offers: z.array(offerSchema).default([]),
  conversation_dynamics: z.object({
    rapport: z.number().min(0).max(1).default(0.5),
    information_asymmetry: z.number().min(0).max(1).default(0.5),
    unspoken_tensions: z.array(z.string()).default([]),
    follow_up_potential: z.boolean().default(false),
  }).default(() => ({ rapport: 0.5, information_asymmetry: 0.5, unspoken_tensions: [], follow_up_potential: false })),
  topic_depth: z.array(z.object({
    topic: z.string(),
    category: z.enum(CATEGORIES).default("other"),
    depth: z.number().min(0).max(1).default(0.5),
  })).default([]),
  engagement_behaviors: z.object({
    asks_clarifying_questions: z.boolean().default(false),
    references_own_experience: z.boolean().default(false),
    shows_active_listening: z.boolean().default(false),
    contributes_solutions: z.boolean().default(false),
    expresses_interest_follow_up: z.boolean().default(false),
  }).default(() => ({ asks_clarifying_questions: false, references_own_experience: false, shows_active_listening: false, contributes_solutions: false, expresses_interest_follow_up: false })),
  evidence_quotes: z.array(z.object({
    field: z.string(),
    index: z.number().default(0),
    quote: z.string(),
  })).default([]),
  key_statements: z.array(z.string()).default([]),
});

type OpusOutput = z.infer<typeof opusOutputSchema>;

// --- カテゴリ正規化（日本語→英語マッピング） ---
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

const VALID_CATEGORIES_SET = new Set(CATEGORIES);

function normalizeCategoryToEnglish(cat: string): typeof CATEGORIES[number] {
  if (!cat) return "other";
  const lower = cat.toLowerCase();
  if (VALID_CATEGORIES_SET.has(lower as typeof CATEGORIES[number])) return lower as typeof CATEGORIES[number];
  for (const [pattern, en] of JA_TO_EN_CATEGORY) {
    if (pattern.test(cat)) return en as typeof CATEGORIES[number];
  }
  return "other";
}

/** Pre-process raw JSON to normalize category fields before Zod enum validation */
function normalizeRawCategories(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;
  for (const key of ["needs", "offers", "topic_depth"]) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && typeof item === "object" && "category" in item) {
        const rec = item as Record<string, unknown>;
        if (typeof rec.category === "string") {
          rec.category = normalizeCategoryToEnglish(rec.category);
        }
      }
    }
  }
}

function normalizeInsightCategories(insights: OpusOutput): OpusOutput {
  return {
    ...insights,
    needs: insights.needs.map((n) => ({
      ...n,
      category: normalizeCategoryToEnglish(n.category),
    })),
    offers: insights.offers.map((o) => ({
      ...o,
      category: normalizeCategoryToEnglish(o.category),
    })),
    topic_depth: insights.topic_depth.map((t) => ({
      ...t,
      category: normalizeCategoryToEnglish(t.category),
    })),
  };
}

// Opus v3.0.0 プロンプト
const PROMPT_V3 = `あなたはビジネスミーティングの構造化分析エキスパートです。
指定された発言者について分析結果をJSONのみで出力してください。簡潔に。

【出力フィールド】
1. needs[] — text, explicit(bool), confidence(0-1), evidence[](max2), signals[], solver_profile(50-150字), urgency_signals[], category, subcategory
   solver_profile: このニーズに応えられる人はどういう人か
2. offers[] — text, explicit(bool), confidence(0-1), evidence[](max2), signals[], beneficiary_profile(50-150字), credibility("実績"|"自己申告"|"推論"), category, subcategory
   beneficiary_profile: このオファーが役立つ人はどういう人か
3. conversation_dynamics — rapport(0-1), information_asymmetry(0-1), unspoken_tensions[], follow_up_potential(bool)
4. topic_depth[] — topic, category, depth(0-1)
5. engagement_behaviors — asks_clarifying_questions, references_own_experience, shows_active_listening, contributes_solutions, expresses_interest_follow_up (全bool)
6. evidence_quotes[] — field, index, quote (max3件)
7. key_statements[] — max3件

【ルール】
- explicit:true→conf0.9+ / false→conf0.5-0.8
- credibility: 実績=具体数字あり / 自己申告=本人のみ / 推論=文脈から
- 日本語婉曲: 「ちょっと気になって」=重要課題 / 「もしよかったら」=明確ニーズ / 「まあ一応」=謙遜=実績 / 「いいですよね」=社交辞令(conf0.4以下)
- カテゴリ: sales,marketing,technology,finance,hr,legal,operations,strategy,design,industry,leadership,other

JSONのみ出力。説明不要。`;

/**
 * 会議品質係数: meeting_type × duration で confidence を調整
 */
function calcMeetingQualityCoeff(
  meetingType: string | null,
  fullText: string,
): number {
  // duration は full_text の長さから推定（文字数ベース）
  const charCount = fullText.length;
  let durationCoeff = 0.7;
  if (charCount >= 20000) durationCoeff = 1.0;      // ~60分相当
  else if (charCount >= 10000) durationCoeff = 0.85; // ~30分
  else if (charCount >= 3000) durationCoeff = 0.7;   // ~15分
  else durationCoeff = 0.5;                           // 短い会議

  let typeCoeff = 1.0;
  if (meetingType === "casual") typeCoeff = 0.7;
  else if (meetingType === "seminar") typeCoeff = 0.8;
  else if (meetingType === "internal") typeCoeff = 0.9;

  return Math.min(1.0, durationCoeff * typeCoeff);
}

export async function handleAnalyze(payload: {
  transcript_id: string;
  participant_id: string;
}): Promise<void> {
  const { transcript_id, participant_id } = payload;

  await supabase
    .from("meeting_transcripts")
    .update({ status: "analyzing" })
    .eq("id", transcript_id);

  const { data: transcript } = await supabase
    .from("meeting_transcripts")
    .select("full_text, corrected_full_text, title, meeting_type")
    .eq("id", transcript_id)
    .single();

  const { data: participant } = await supabase
    .from("meeting_participants")
    .select("speaker_name")
    .eq("id", participant_id)
    .single();

  if (!transcript?.full_text || !participant) {
    throw new Error("Transcript or participant not found");
  }

  // 3-way 補正済み (corrected_full_text) があればそちらを使う (00065 で追加)。
  // 未補正 (NULL) なら従来通り full_text を使う後方互換。
  const textToAnalyze: string = transcript.corrected_full_text ?? transcript.full_text;

  // アクティブなプロンプトを取得（v3.0.0 優先、なければハードコード使用）
  const { data: promptVersion } = await supabase
    .from("prompt_versions")
    .select("template, version")
    .eq("name", "transcript_analysis")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const promptTemplate = promptVersion?.template?.startsWith("V3_OPUS_PROMPT")
    ? PROMPT_V3
    : promptVersion?.template ?? PROMPT_V3;

  const promptVersionStr = promptVersion?.version ?? "3.0.0";

  // 会議品質係数 (補正済みテキストがあればそれを使う)
  const qualityCoeff = calcMeetingQualityCoeff(
    transcript.meeting_type,
    textToAnalyze,
  );

  // Claude Opus 4.6 呼び出し
  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${promptTemplate}\n\n## 発言者: ${participant.speaker_name}\n\n## トランスクリプト:\n${textToAnalyze.slice(0, 30000)}`,
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  // JSON パース + Zod バリデーション
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in Opus response: ${text.slice(0, 200)}`);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Failed to parse Opus JSON: ${text.slice(0, 200)}`);
  }

  // Pre-normalize: 日本語カテゴリを英語に変換してからZodバリデーション
  normalizeRawCategories(rawJson);

  // Zod バリデーション（default値で欠損フィールドを補完）
  let insights: OpusOutput;
  try {
    insights = opusOutputSchema.parse(rawJson);
  } catch (zodError) {
    console.warn("Zod validation failed, retrying with fallback prompt...", zodError);

    // フォールバック: 再試行
    const retryResponse = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${promptTemplate}\n\n[重要: JSON形式を厳密に守ってください。全フィールドを含めてください。]\n\n## 発言者: ${participant.speaker_name}\n\n## トランスクリプト:\n${textToAnalyze.slice(0, 25000)}`,
        },
      ],
    });

    const retryText = retryResponse.content[0]?.type === "text" ? retryResponse.content[0].text : "";
    const retryMatch = retryText.match(/\{[\s\S]*\}/);
    if (!retryMatch) throw new Error("Fallback: No JSON found");

    try {
      const retryRaw = JSON.parse(retryMatch[0]);
      normalizeRawCategories(retryRaw);
      insights = opusOutputSchema.parse(retryRaw);
    } catch {
      // 最終フォールバック: 最低限のデータで構築
      const partial = JSON.parse(retryMatch[0]) as Record<string, unknown>;
      normalizeRawCategories(partial);
      insights = opusOutputSchema.parse({
        needs: Array.isArray(partial.needs) ? partial.needs : [],
        offers: Array.isArray(partial.offers) ? partial.offers : [],
        key_statements: Array.isArray(partial.key_statements) ? partial.key_statements : [],
      });
    }
  }

  // カテゴリ正規化（日本語→英語）— Opus が日本語カテゴリを返すケースを修正
  insights = normalizeInsightCategories(insights);

  // needs/offers に会議品質係数を適用
  const needs = insights.needs.map((n) => ({
    ...n,
    confidence: Math.min(1.0, n.confidence * qualityCoeff),
  }));

  const offers = insights.offers.map((o) => ({
    ...o,
    confidence: Math.min(1.0, o.confidence * qualityCoeff),
  }));

  // transcript_insights に UPSERT
  // needs/offers は solver_profile/beneficiary_profile/explicit/signals 等を含む完全な構造体
  const { error } = await supabase.from("transcript_insights").upsert(
    {
      transcript_id,
      participant_id,
      demonstrated_skills: [],
      expressed_needs: needs,
      offered_capabilities: offers,
      communication_traits: {
        ...insights.conversation_dynamics,
        engagement_behaviors: insights.engagement_behaviors,
      },
      key_statements: insights.key_statements,
      engagement_metrics: {
        topic_depth: insights.topic_depth,
        evidence_quotes: insights.evidence_quotes,
      },
      confidence_score: insights.conversation_dynamics.rapport,
      prompt_version: promptVersionStr,
    },
    { onConflict: "transcript_id,participant_id" },
  );

  if (error) {
    console.error("Failed to upsert transcript_insights:", error.message);
    throw error;
  }

  await supabase
    .from("meeting_transcripts")
    .update({ status: "analyzed" })
    .eq("id", transcript_id);

  // 分析対象の participant が既に user に紐付け済なら、 aggregate ジョブを
  // enqueue して member_ai_profiles_v2 / user_conversation_vectors を更新する。
  // tl;dv 経由の自動分析でも紐付け済 user の AI profile が自動更新されるよう、
  // link RPC 経由 (00057) と analyze 経由の両ルートで aggregate を起動する。
  const { data: linkedParticipant } = await supabase
    .from("meeting_participants")
    .select("user_id, is_linked")
    .eq("id", participant_id)
    .maybeSingle();

  if (linkedParticipant?.user_id && linkedParticipant.is_linked) {
    await enqueueJob("aggregate", { user_id: linkedParticipant.user_id }, 5);
  }
}
