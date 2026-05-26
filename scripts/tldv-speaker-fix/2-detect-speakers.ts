// 抽出済みのフレームを Gemini Flash Lite に投げて active speaker timeline を生成
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/2-detect-speakers.ts \
//     --frames-dir scripts/tldv-speaker-fix/frames \
//     --out        scripts/tldv-speaker-fix/output/speakers.json \
//     --every      2 \
//     [--limit 10]              # 最初の N フレームだけ処理 (PoC 動作確認用)
//     [--concurrency 5]         # 並列リクエスト数 (Gemini の rate limit に注意)
//
// 出力: { generatedAt, frameInterval, model, items: [{ frameIndex, timestampSec, speaker, confidence, raw }] }
//
// speaker は以下のいずれか:
//   "left"   — 左タイルが active speaker (青い枠 or マイク波形)
//   "right"  — 右タイルが active speaker
//   "both"   — 両方の枠が点灯 (被り発話)
//   "none"   — どちらも明確な active 信号なし (沈黙 / 切替中 / 画面共有等)
//   "other"  — レイアウト変化等で判定不能
//
// メモ:
//   - Flash Lite は実用上 1 秒未満で1リクエスト返る。並列で 5〜10 走らせれば 100 フレーム/分以上のスループット
//   - JSON 形式の structured output を要求している (responseMimeType: "application/json")
//   - 失敗したフレームは speaker="error" として記録 (後段で再試行可能にするため)

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface Args {
  framesDir: string;
  out: string;
  every: number;
  limit?: number;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const framesDir = get("--frames-dir");
  const out = get("--out");
  if (!framesDir || !out) {
    console.error("Usage: --frames-dir <dir> --out <json> [--every <sec>] [--limit <n>] [--concurrency <n>]");
    process.exit(1);
  }
  return {
    framesDir: resolve(framesDir),
    out: resolve(out),
    every: Number(get("--every") ?? 2),
    limit: get("--limit") ? Number(get("--limit")) : undefined,
    concurrency: Number(get("--concurrency") ?? 5),
  };
}

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

interface SpeakerResult {
  frameIndex: number;
  timestampSec: number;
  speaker: "left" | "right" | "both" | "none" | "error";
  confidence: number;
  reason?: string;
  raw?: string;
  errorMessage?: string;
}

async function classifyFrame(
  client: GoogleGenerativeAI,
  framePath: string,
  frameIndex: number,
  timestampSec: number,
  maxRetries = 4,
): Promise<SpeakerResult> {
  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const imageBytes = await readFile(framePath);
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
        speaker: SpeakerResult["speaker"];
        confidence: number;
        reason?: string;
      };
      return {
        frameIndex,
        timestampSec,
        speaker: parsed.speaker,
        confidence: parsed.confidence,
        reason: parsed.reason,
        raw: text,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // 503 / 429 / 500 はリトライ価値あり
      if (!/503|429|500|ECONNRESET|fetch failed/i.test(msg)) break;
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * 2 ** attempt + Math.random() * 500, 8000);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return {
    frameIndex,
    timestampSec,
    speaker: "error",
    confidence: 0,
    errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

// 簡易並列プール: concurrency 個ずつ並行で消化
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
        done++;
        onProgress?.(done, items.length);
      }
    }),
  );
  return results;
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in .env.local");
  }

  const allFrames = (await readdir(args.framesDir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  const frames = args.limit ? allFrames.slice(0, args.limit) : allFrames;

  console.log("[info]", {
    framesDir: args.framesDir,
    totalFrames: allFrames.length,
    processing: frames.length,
    everySec: args.every,
    concurrency: args.concurrency,
    model: "gemini-2.5-flash-lite",
  });

  const client = new GoogleGenerativeAI(apiKey);

  const t0 = Date.now();
  const results = await runPool(
    frames,
    args.concurrency,
    async (file, idx) => {
      // frame_00001.jpg → frameIndex=1, timestampSec=(1-1)*every=0
      const m = file.match(/frame_(\d+)\.jpg$/);
      const frameIndex = m ? parseInt(m[1], 10) : idx + 1;
      const timestampSec = (frameIndex - 1) * args.every;
      return classifyFrame(client, join(args.framesDir, file), frameIndex, timestampSec);
    },
    (done, total) => {
      if (done % 10 === 0 || done === total) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = ((total - done) / rate).toFixed(1);
        process.stdout.write(
          `\r[progress] ${done}/${total}  (${rate.toFixed(1)} fps, ETA ${eta}s)`,
        );
      }
    },
  );
  process.stdout.write("\n");

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // 集計
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.speaker] = (counts[r.speaker] ?? 0) + 1;
  console.log("[summary]", { elapsedSec: elapsed, counts });

  // 出力
  await mkdir(dirname(args.out), { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    frameIntervalSec: args.every,
    model: "gemini-2.5-flash-lite",
    totalFrames: results.length,
    counts,
    items: results,
  };
  await writeFile(args.out, JSON.stringify(output, null, 2), "utf-8");
  console.log(`[done] ${results.length} frames → ${args.out}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
