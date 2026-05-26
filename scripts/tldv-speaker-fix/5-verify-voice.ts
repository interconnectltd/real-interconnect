// 各 transcript セグメントから音声クリップを抽出 → Gemini に「誰の声か」聞く
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/5-verify-voice.ts \
//     --video      scripts/tldv-speaker-fix/samples/sample-meeting-2.mp4 \
//     --transcript scripts/tldv-speaker-fix/samples/transcript.txt \
//     --ref-sara   scripts/tldv-speaker-fix/audio/refs/sara.mp3 \
//     --ref-tajima scripts/tldv-speaker-fix/audio/refs/tajima.mp3 \
//     --out        scripts/tldv-speaker-fix/output/audio-verify.json \
//     --concurrency 6
//
// 各セグメントの中央5秒を抽出して Gemini 2.5 Flash に投げ、声紋照合させる。
// セグメントが5秒未満なら全長使用。

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

interface Args {
  video: string;
  transcript: string;
  refSara: string;
  refTajima: string;
  out: string;
  concurrency: number;
  clipSec: number;
  limit?: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const video = get("--video");
  const transcript = get("--transcript");
  const refSara = get("--ref-sara");
  const refTajima = get("--ref-tajima");
  const out = get("--out");
  if (!video || !transcript || !refSara || !refTajima || !out) {
    console.error("Usage: --video <mp4> --transcript <txt> --ref-sara <mp3> --ref-tajima <mp3> --out <json> [--concurrency <n>] [--clip-sec <n>]");
    process.exit(1);
  }
  return {
    video: resolve(video),
    transcript: resolve(transcript),
    refSara: resolve(refSara),
    refTajima: resolve(refTajima),
    out: resolve(out),
    concurrency: Number(get("--concurrency") ?? 6),
    clipSec: Number(get("--clip-sec") ?? 5),
    limit: get("--limit") ? Number(get("--limit")) : undefined,
  };
}

interface Segment { speaker: string; startSec: number; text: string; }

function parseTranscript(raw: string): Segment[] {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const segs: Segment[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\s+\[(\d{1,2}):(\d{2})\]:\s*(.*)$/);
    if (!m) continue;
    const [, speaker, mm, ss, text] = m;
    segs.push({
      speaker: speaker.trim(),
      startSec: parseInt(mm, 10) * 60 + parseInt(ss, 10),
      text: text.trim(),
    });
  }
  return segs;
}

// ffmpeg を使って video の任意区間の音声を mp3 で stdout に吐き出させる
async function extractClip(video: string, startSec: number, durationSec: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", [
      "-y",
      "-ss", String(startSec),
      "-t", String(durationSec),
      "-i", video,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "32k",
      "-f", "mp3",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("error", rej);
    p.on("close", (code) => {
      if (code === 0) res(Buffer.concat(chunks));
      else rej(new Error(`ffmpeg exited ${code}`));
    });
  });
}

const PROMPT = `あなたは音声話者識別アシスタントです。
3つの音声を渡します。順番に注意してください。

【参照1: sara の声サンプル】
【参照2: 田島の声サンプル】
【検証する音声クリップ】

タスク: 検証音声の主な話者を、参照1 (sara) または参照2 (田島) の声と照合してください。
判定基準は声質・話し方の類似度のみ。意味内容や役割は考慮しないでください。
- 検証音声に複数の声が混ざる場合は、より主体的に話している方
- どちらにも明確に一致しない / 沈黙 / 1秒未満で判別不能 → "unknown"

出力は厳密な JSON 1つだけ:
{
  "speaker": "sara" | "tajima" | "unknown",
  "confidence": 0.0 から 1.0,
  "reason": "声質類似度に基づく簡潔な根拠 (40文字以内)"
}`;

interface AudioResult {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  midSec: number;
  clipDurationSec: number;
  transcriptSpeaker: string;
  speaker: "sara" | "tajima" | "unknown" | "error";
  confidence: number;
  reason?: string;
  errorMessage?: string;
}

async function classifySegment(
  client: GoogleGenerativeAI,
  saraRefB64: string,
  tajimaRefB64: string,
  video: string,
  seg: Segment,
  endSec: number,
  segmentIndex: number,
  clipSec: number,
  maxRetries = 3,
): Promise<AudioResult> {
  const duration = endSec - seg.startSec;
  const useDur = Math.max(1, Math.min(clipSec, duration - 0.3));
  const midSec = seg.startSec + Math.max(0, (duration - useDur) / 2);

  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const clip = await extractClip(video, midSec, useDur);
      const result = await model.generateContent([
        PROMPT,
        { text: "【参照1: sara】" },
        { inlineData: { mimeType: "audio/mp3", data: saraRefB64 } },
        { text: "【参照2: 田島】" },
        { inlineData: { mimeType: "audio/mp3", data: tajimaRefB64 } },
        { text: "【検証する音声】" },
        { inlineData: { mimeType: "audio/mp3", data: clip.toString("base64") } },
      ]);
      const text = result.response.text();
      const parsed = JSON.parse(text) as { speaker: AudioResult["speaker"]; confidence: number; reason?: string };
      return {
        segmentIndex,
        startSec: seg.startSec,
        endSec,
        midSec,
        clipDurationSec: useDur,
        transcriptSpeaker: seg.speaker,
        speaker: parsed.speaker,
        confidence: parsed.confidence,
        reason: parsed.reason,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/503|429|500|ECONNRESET|fetch failed/i.test(msg)) break;
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * 2 ** attempt + Math.random() * 500, 8000);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return {
    segmentIndex,
    startSec: seg.startSec,
    endSec,
    midSec: 0,
    clipDurationSec: 0,
    transcriptSpeaker: seg.speaker,
    speaker: "error",
    confidence: 0,
    errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T, i: number) => Promise<R>, onProgress?: (d: number, t: number) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  }));
  return results;
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const [saraRef, tajimaRef, transcriptRaw] = await Promise.all([
    readFile(args.refSara),
    readFile(args.refTajima),
    readFile(args.transcript, "utf-8"),
  ]);
  const saraRefB64 = saraRef.toString("base64");
  const tajimaRefB64 = tajimaRef.toString("base64");

  const allSegments = parseTranscript(transcriptRaw);
  const segments = args.limit ? allSegments.slice(0, args.limit) : allSegments;
  // 最後のセグメントの終端は仮で +30 秒
  const segEnds = segments.map((s, i) => segments[i + 1]?.startSec ?? s.startSec + 30);

  console.log("[info]", {
    segments: segments.length,
    refSaraSize: saraRef.length,
    refTajimaSize: tajimaRef.length,
    clipSec: args.clipSec,
    concurrency: args.concurrency,
    model: "gemini-2.5-flash",
  });

  const client = new GoogleGenerativeAI(apiKey);
  const t0 = Date.now();

  const results = await runPool(
    segments,
    args.concurrency,
    (seg, i) => classifySegment(client, saraRefB64, tajimaRefB64, args.video, seg, segEnds[i], i, args.clipSec),
    (done, total) => {
      if (done % 5 === 0 || done === total) {
        const e = (Date.now() - t0) / 1000;
        const rate = done / e;
        process.stdout.write(`\r[progress] ${done}/${total}  (${rate.toFixed(2)}/s, ETA ${((total - done) / rate).toFixed(0)}s)`);
      }
    },
  );
  process.stdout.write("\n");

  const counts: Record<string, number> = {};
  for (const r of results) counts[r.speaker] = (counts[r.speaker] ?? 0) + 1;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("[summary]", { elapsedSec: elapsed, counts });

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: "gemini-2.5-flash",
    refs: { sara: args.refSara, tajima: args.refTajima },
    clipSec: args.clipSec,
    totalSegments: results.length,
    counts,
    items: results,
  }, null, 2), "utf-8");
  console.log(`[done] ${results.length} segments → ${args.out}`);
}

main().catch((e) => { console.error("[fatal]", e); process.exit(1); });
