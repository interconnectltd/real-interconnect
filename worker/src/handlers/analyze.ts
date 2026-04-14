/**
 * analyze ハンドラ V2: Claude Opus 4.6 で transcript を v3.0.0 構造化抽出
 * SCORING_V2_ARCHITECTURE.md §1 — Opus構造化抽出（レイヤー1）
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { supabase } from "../queue";

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
  solver_profile: z.string().default(""),
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
  beneficiary_profile: z.string().default(""),
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

// Opus v3.0.0 プロンプト
const PROMPT_V3 = `あなたはビジネスミーティングの高度な構造化分析エキスパートです。
以下のトランスクリプトから、指定された発言者について分析結果をJSONのみで出力してください。

【出力フィールド】
1. needs[] — ニーズ・課題
   各項目: text, explicit(boolean), confidence(0-1), evidence[], signals[], solver_profile(50-200字), urgency_signals[], category, subcategory
   - solver_profile: 「このニーズに応えられる人はどういう人か」を自然言語で詳細記述
   - explicit: true=直接言及, false=文脈から推論
   - implicit(explicit:false)のconfidence下限: 0.5

2. offers[] — 提供可能な価値
   各項目: text, explicit(boolean), confidence(0-1), evidence[], signals[], beneficiary_profile(50-200字), credibility("実績"|"自己申告"|"推論"), category, subcategory
   - beneficiary_profile: 「このオファーが役立つ人はどういう人か」を自然言語で詳細記述

3. conversation_dynamics — ペア間会話品質
   rapport(0-1), information_asymmetry(0-1), unspoken_tensions[], follow_up_potential(boolean)

4. topic_depth[] — トピック深度
   各項目: topic, category, depth(0-1: 0.3=言及, 0.6=議論, 1.0=深掘り)

5. engagement_behaviors — 参加行動
   asks_clarifying_questions(bool), references_own_experience(bool), shows_active_listening(bool), contributes_solutions(bool), expresses_interest_follow_up(bool)

6. evidence_quotes[] — 根拠引用（内部用）
   各項目: field("needs"|"offers"|"dynamics"), index(number), quote(原文引用)

7. key_statements[] — 重要発言の要約（最大5件）

【日本語ビジネス婉曲対策】
- 「ちょっと気になって」→ 重要課題。explicit:true, confidence:0.85+
- 「もしよかったら」→ 明確ニーズ。explicit:true
- 「まあ一応」→ 謙遜=実績。credibility:"推論"
- 「いいですよね」→ 社交辞令。explicit:false, confidence:0.4以下

【signals（推論根拠）】
同トピック2回言及→重要 / 具体的数字→高信頼 / 質問の具体性→ニーズvs社交辞令 / 発言の長さ→関心度

【confidence基準】
explicit:true → 0.9-1.0 / explicit:false → 0.5-0.8（下限0.5保証）

【credibility（offersの信頼性）】
"実績": 成功事例・具体数字あり / "自己申告": 本人申告のみ / "推論": 文脈から推測

【カテゴリ】
大: sales, marketing, technology, finance, hr, legal, operations, strategy, design, industry, leadership, other
小: sales_strategy, sales_channel, sales_management, digital_marketing, branding, content, analytics, software_dev, infrastructure, data_ai, security, accounting, fundraising, financial_planning, recruiting, talent_dev, labor_mgmt, culture, corporate_law, ip, compliance, supply_chain, quality, project_mgmt, business_dev, m_and_a, international, ux_ui, product_design, creative, healthcare, realestate, manufacturing, education, energy, executive, mentoring, change_mgmt, other

矛盾を検出したら該当項目のconfidenceを低下させてください。
JSONのみ出力してください。`;

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
    .select("full_text, title, meeting_type")
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

  // アクティブなプロンプトを取得（v3.0.0 優先、なければハードコード使用）
  const { data: promptVersion } = await supabase
    .from("prompt_versions")
    .select("template, version")
    .eq("name", "transcript_analysis")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const promptTemplate = promptVersion?.template === "V3_OPUS_PROMPT"
    ? PROMPT_V3
    : promptVersion?.template ?? PROMPT_V3;

  const promptVersionStr = promptVersion?.version ?? "3.0.0";

  // 会議品質係数
  const qualityCoeff = calcMeetingQualityCoeff(
    transcript.meeting_type,
    transcript.full_text,
  );

  // Claude Opus 4.6 呼び出し
  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: `${promptTemplate}\n\n## 発言者: ${participant.speaker_name}\n\n## トランスクリプト:\n${transcript.full_text.slice(0, 30000)}`,
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

  // Zod バリデーション（default値で欠損フィールドを補完）
  let insights: OpusOutput;
  try {
    insights = opusOutputSchema.parse(rawJson);
  } catch (zodError) {
    console.warn("Zod validation failed, retrying with fallback prompt...", zodError);

    // フォールバック: 再試行
    const retryResponse = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: `${promptTemplate}\n\n[重要: JSON形式を厳密に守ってください。全フィールドを含めてください。]\n\n## 発言者: ${participant.speaker_name}\n\n## トランスクリプト:\n${transcript.full_text.slice(0, 25000)}`,
        },
      ],
    });

    const retryText = retryResponse.content[0]?.type === "text" ? retryResponse.content[0].text : "";
    const retryMatch = retryText.match(/\{[\s\S]*\}/);
    if (!retryMatch) throw new Error("Fallback: No JSON found");

    try {
      insights = opusOutputSchema.parse(JSON.parse(retryMatch[0]));
    } catch {
      // 最終フォールバック: 最低限のデータで構築
      const partial = JSON.parse(retryMatch[0]) as Record<string, unknown>;
      insights = opusOutputSchema.parse({
        needs: Array.isArray(partial.needs) ? partial.needs : [],
        offers: Array.isArray(partial.offers) ? partial.offers : [],
        key_statements: Array.isArray(partial.key_statements) ? partial.key_statements : [],
      });
    }
  }

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
      demonstrated_skills: insights.key_statements,
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
}
