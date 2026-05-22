// Gemini 2.5 Flash Lite (vision) で 1 フレームの active speaker を判定。
// PoC の `2-detect-speakers.ts` から抽出。

import { readFile } from "node:fs/promises";
import type { GoogleGenerativeAI } from "@google/generative-ai";

import type { VideoSpeaker } from "./timeline";

const PROMPT = `あなたはオンライン会議の画面を分析するアシスタントです。

入力画像は Zoom 会議のスクリーンショットで、参加者のタイルが横並び (左 / 右) に表示されています。

タスク: 「現在、どちらのタイルが active speaker (今話している人) か」を判定してください。

判定の手がかり (重要度順):
1. タイル全体を囲む青い太い枠 (一番確実)
2. タイル右上のマイクアイコンが青い波形を表示している
3. 上記いずれかが両方のタイルに同時に出ている場合は "both"

出力は厳密な JSON 1つだけ:
{
  "speaker": "left" | "right" | "both" | "none",
  "confidence": 0.0 から 1.0,
  "reason": "簡潔な日本語での根拠 (50文字以内)"
}

注意:
- 両方とも信号なし → "none"
- どちらも口を動かしているように見えても、信号がなければ "none"
- 画面共有・レイアウト変化等で判断不能 → "none" + confidence 低め
- マークダウンや前置きは不要、JSON のみ`;

export interface FrameClassification {
  speaker: VideoSpeaker;
  confidence: number;
  reason?: string;
  errorMessage?: string;
  /** 生レスポンス (デバッグ用) */
  raw?: string;
}

interface ClassifyOptions {
  maxRetries?: number;
  /** モデル ID 上書き (テスト用)。デフォルトは gemini-2.5-flash-lite */
  model?: string;
}

const RETRY_REGEX = /503|429|500|ECONNRESET|fetch failed/i;

/** ファイルパスから JPG を読み込んで分類 */
export async function classifyFrameFile(
  client: GoogleGenerativeAI,
  framePath: string,
  options: ClassifyOptions = {},
): Promise<FrameClassification> {
  const bytes = await readFile(framePath);
  return classifyFrameBuffer(client, bytes, options);
}

/** メモリ上の JPG バッファをそのまま分類 (`extractSingleFrame` と組み合わせる用) */
export async function classifyFrameBuffer(
  client: GoogleGenerativeAI,
  imageBytes: Buffer,
  options: ClassifyOptions = {},
): Promise<FrameClassification> {
  const maxRetries = options.maxRetries ?? 4;
  const model = client.getGenerativeModel({
    model: options.model ?? "gemini-2.5-flash-lite",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent([
        PROMPT,
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBytes.toString("base64"),
          },
        },
      ]);
      const text = result.response.text();
      const parsed = JSON.parse(text) as {
        speaker: VideoSpeaker;
        confidence: number;
        reason?: string;
      };
      return {
        speaker: parsed.speaker,
        confidence: parsed.confidence,
        reason: parsed.reason,
        raw: text,
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
