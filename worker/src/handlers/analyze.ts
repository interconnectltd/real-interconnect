/**
 * analyze ハンドラ: Claude Sonnet で transcript を分析
 * ARCHITECTURE.md §4.1 Step 4
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../queue";

const anthropic = new Anthropic({
  apiKey: process.env.AI_API_KEY!,
});

export async function handleAnalyze(payload: {
  transcript_id: string;
  participant_id: string;
}): Promise<void> {
  const { transcript_id, participant_id } = payload;

  // transcript のステータスを analyzing に
  await supabase
    .from("meeting_transcripts")
    .update({ status: "analyzing" })
    .eq("id", transcript_id);

  // transcript + participant の情報取得
  const { data: transcript } = await supabase
    .from("meeting_transcripts")
    .select("full_text, title")
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

  // アクティブなプロンプトを取得
  const { data: promptVersion } = await supabase
    .from("prompt_versions")
    .select("template")
    .eq("name", "transcript_analysis")
    .eq("is_active", true)
    .single();

  if (!promptVersion) throw new Error("Active prompt version not found");

  // Claude API 呼び出し
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `${promptVersion.template}\n\n## 発言者: ${participant.speaker_name}\n\n## トランスクリプト:\n${transcript.full_text}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  // JSON パース
  let insights: Record<string, unknown>;
  try {
    // レスポンスからJSON部分を抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    insights = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Failed to parse Claude response: ${text.slice(0, 200)}`);
  }

  // transcript_insights に UPSERT
  await supabase.from("transcript_insights").upsert(
    {
      transcript_id,
      participant_id,
      demonstrated_skills: insights.demonstrated_skills ?? [],
      expressed_needs: insights.expressed_needs ?? [],
      offered_capabilities: insights.offered_capabilities ?? [],
      communication_traits: insights.communication_traits ?? {},
      key_statements: insights.key_statements ?? [],
      engagement_metrics: insights.engagement_metrics ?? {},
      confidence_score: insights.confidence_score ?? null,
      prompt_version: "2.0.0",
    },
    { onConflict: "transcript_id,participant_id" },
  );

  // transcript ステータスを analyzed に
  await supabase
    .from("meeting_transcripts")
    .update({ status: "analyzed" })
    .eq("id", transcript_id);
}
