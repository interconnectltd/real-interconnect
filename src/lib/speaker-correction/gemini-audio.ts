// Gemini 2.5 Flash (audio) で声紋照合。
// PoC の `5-verify-voice.ts` から抽出。
//
// PoC 版は "sara" "tajima" の 2 名固定だったが、本ライブラリでは
// 任意の N 名の参照声を扱えるよう一般化 (監査の "2 人前提" 指摘対応)。
// ただし 1on1 でしか使わない方針なので、通常 N=2。

import type { GoogleGenerativeAI } from "@google/generative-ai";

export interface ReferenceVoice {
  /** 正規化 ID。例 "tajima" / "sara" */
  id: string;
  /** プロンプト内表示名。例 "田島" / "sara" */
  displayLabel: string;
  /** mp3 等の音声バッファ (10〜15 秒推奨) */
  audioBuffer: Buffer;
  /** デフォルト "audio/mp3" */
  mimeType?: string;
}

export interface AudioClassification {
  /** 一致した参照声の ID。一致しなければ "unknown" */
  speaker: string | "unknown" | "error";
  confidence: number;
  reason?: string;
  errorMessage?: string;
}

interface ClassifyOptions {
  maxRetries?: number;
  model?: string;
}

const RETRY_REGEX = /503|429|500|ECONNRESET|fetch failed/i;

/**
 * セグメント中央付近から音声クリップを取り出すための ffmpeg 引数を計算。
 * PoC `5-verify-voice.ts` の挙動を完全再現:
 *   useDur = max(1, min(targetClipSec, duration - 0.3))   // 端は被り発話で他者の声混入を避けて 0.3 秒削る
 *   midSec = startSec + max(0, (duration - useDur) / 2)   // 中央寄せ
 */
export function computeAudioExtractParams(
  segmentStartSec: number,
  segmentEndSec: number,
  targetClipSec: number,
): { startSec: number; durationSec: number } {
  const duration = segmentEndSec - segmentStartSec;
  const durationSec = Math.max(1, Math.min(targetClipSec, duration - 0.3));
  const startSec = segmentStartSec + Math.max(0, (duration - durationSec) / 2);
  return { startSec, durationSec };
}

/**
 * 検証音声 (clip) が参照声 (refs) のどれと一致するかを判定。
 * 「声質類似度」のみで判定するようプロンプト指示 (内容・役割の解釈を抑制)。
 */
export async function classifyAudioClip(
  client: GoogleGenerativeAI,
  clip: Buffer,
  refs: ReadonlyArray<ReferenceVoice>,
  options: ClassifyOptions = {},
): Promise<AudioClassification> {
  if (refs.length < 1) {
    throw new Error("classifyAudioClip: at least one reference voice required");
  }

  const maxRetries = options.maxRetries ?? 3;
  const model = client.getGenerativeModel({
    model: options.model ?? "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  const refDescriptions = refs
    .map((r, i) => `【参照${i + 1}: ${r.displayLabel} の声サンプル】`)
    .join("\n");

  const speakerEnum = [...refs.map((r) => `"${r.id}"`), `"unknown"`].join(" | ");

  const prompt = `あなたは音声話者識別アシスタントです。
${refs.length + 1}つの音声を順番に渡します。

${refDescriptions}
【検証する音声クリップ】

タスク: 検証音声の主な話者を、上記の参照声と照合してください。
判定基準は声質・話し方の類似度のみ。意味内容や役割は考慮しないでください。
- 検証音声に複数の声が混ざる場合は、より主体的に話している方
- どの参照声にも明確に一致しない / 沈黙 / 1秒未満で判別不能 → "unknown"

出力は厳密な JSON 1つだけ:
{
  "speaker": ${speakerEnum},
  "confidence": 0.0 から 1.0,
  "reason": "声質類似度に基づく簡潔な根拠 (40文字以内)"
}`;

  const parts = [
    { text: prompt },
    ...refs.flatMap((r) => [
      { text: `【参照: ${r.displayLabel}】` },
      {
        inlineData: {
          mimeType: r.mimeType ?? "audio/mp3",
          data: r.audioBuffer.toString("base64"),
        },
      },
    ]),
    { text: "【検証する音声】" },
    {
      inlineData: {
        mimeType: "audio/mp3",
        data: clip.toString("base64"),
      },
    },
  ];

  const validIds = new Set(refs.map((r) => r.id));

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(parts);
      const text = result.response.text();
      const parsed = JSON.parse(text) as {
        speaker: string;
        confidence: number;
        reason?: string;
      };
      // 想定外の ID が返ってきたら "unknown" に降格
      const speaker = parsed.speaker === "unknown" || validIds.has(parsed.speaker)
        ? parsed.speaker
        : "unknown";
      return {
        speaker,
        confidence: parsed.confidence,
        reason: parsed.reason,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!RETRY_REGEX.test(msg)) break;
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * 2 ** attempt + Math.random() * 500, 8000);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return {
    speaker: "error",
    confidence: 0,
    errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
