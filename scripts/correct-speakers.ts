// 3-way speaker correction CLI (MVP)
//
// 動画 mp4 + transcript + 参照声サンプル から、tldv の話者ラベル誤判定を
// 自動補正した transcript を JSON で出力する。 DB 書き込みはまだ実装しない
// (= 安全に試せる。 sara が中身を確認してから DB 反映する想定)。
//
// === 使い方 ===
//
//   pnpm correct-speakers \
//     --video        ~/Downloads/田島-2026-05-10.mp4 \
//     --transcript   ./scripts/tldv-speaker-fix/samples/transcript.txt \
//     --ref-dir      ./scripts/tldv-speaker-fix/audio/refs \
//     --left         "田島康平"      --left-id  tajima \
//     --right        "connect inter" --right-id sara \
//     --out          ./output/cli-test.json \
//     [--limit-seconds 600]   # 動画の最初の N 秒だけ処理
//     [--skip-frames]          # 既存フレームを再利用 (連続実行時のコスト削減)
//     [--work-dir <path>]      # 中間ファイル置き場 (デフォルト e2e-work/)
//
// === 引数 ===
//
//   --video       mp4 ファイル絶対 or 相対パス (必須)
//   --transcript  transcript テキスト ("<speaker> [MM:SS]: <text>" 形式、必須)
//   --ref-dir     参照声 mp3 dir。 配下に <left-id>.mp3 と <right-id>.mp3 が必要
//   --left        左タイルの speaker 生名 (transcript と完全一致)
//   --left-id     左タイルの正規化 ID (例: tajima)
//   --right       右タイルの speaker 生名
//   --right-id    右タイルの正規化 ID
//   --out         出力 JSON 絶対 or 相対パス
//
// === MVP の制限 ===
//
//   - DB 書き込みなし (DB 統合は次フェーズ)
//   - 2 人会議のみ対応 (transcript の unique speaker が 3 以上だと skip)
//   - 参照声は手動用意必須 (--ref-dir/<speaker-id>.mp3)
//   - filename → Supabase 自動 lookup は未実装 (次フェーズ)

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  correctSpeakers,
  parseTranscriptText,
  type CorrectSpeakersOutput,
  type ReferenceVoice,
} from "../src/lib/speaker-correction";

// ──────────────────────────────────────────────────────────────────
// CLI 引数パース
// ──────────────────────────────────────────────────────────────────

interface CliArgs {
  video: string;
  transcript: string;
  refDir: string;
  leftName: string;
  rightName: string;
  leftId: string;
  rightId: string;
  out: string;
  workDir: string;
  limitSeconds?: number;
  skipFrames: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const video = get("--video");
  const transcript = get("--transcript");
  const refDir = get("--ref-dir");
  const leftName = get("--left");
  const rightName = get("--right");
  const leftId = get("--left-id");
  const rightId = get("--right-id");
  const out = get("--out");

  if (!video || !transcript || !refDir || !leftName || !rightName || !leftId || !rightId || !out) {
    console.error(
      "Usage: pnpm correct-speakers \\\n" +
        "  --video <path> --transcript <path> --ref-dir <dir> \\\n" +
        "  --left <name> --left-id <id> --right <name> --right-id <id> \\\n" +
        "  --out <path> [--limit-seconds N] [--skip-frames] [--work-dir <path>]\n",
    );
    process.exit(1);
  }

  return {
    video: resolve(video),
    transcript: resolve(transcript),
    refDir: resolve(refDir),
    leftName,
    rightName,
    leftId,
    rightId,
    out: resolve(out),
    workDir: resolve(get("--work-dir") ?? "./scripts/tldv-speaker-fix/e2e-work"),
    limitSeconds: get("--limit-seconds") ? Number(get("--limit-seconds")) : undefined,
    skipFrames: has("--skip-frames"),
  };
}

// ──────────────────────────────────────────────────────────────────
// エラーバイル
// ──────────────────────────────────────────────────────────────────

function bail(message: string, hint?: string, exitCode: 1 | 2 = 1): never {
  console.error(`[correct-speakers] ERROR: ${message}`);
  if (hint) console.error(`  hint: ${hint}`);
  process.exit(exitCode);
}

// ──────────────────────────────────────────────────────────────────
// 出力 JSON スキーマ
// ──────────────────────────────────────────────────────────────────

interface OutputCorrection {
  idx: number;
  time: string;
  originalLabel: string;
  newLabel: string;
  text: string;
}

interface OutputJson {
  videoPath: string;
  speakerMap: {
    left: { name: string; id: string };
    right: { name: string; id: string };
  };
  summary: {
    totalSegments: number;
    correctedSegments: number;
    correctionConfidence: number;
    durationSec: number;
    visionFrames: number;
    visionErrors: number;
    audioCalls: number;
    audioErrors: number;
    audioFloorApplied: number;
  };
  correctedFullText: string;
  corrections: OutputCorrection[];
  perSegment: CorrectSpeakersOutput["perSegment"];
  meta: CorrectSpeakersOutput["meta"];
  generatedAt: string;
}

// ──────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // 環境変数チェック
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    bail("GEMINI_API_KEY not set", "Add GEMINI_API_KEY=... to .env.local", 2);
  }

  // ファイル存在チェック
  if (!existsSync(args.video)) {
    bail(`video file not found: ${args.video}`, "Check the --video path");
  }
  if (!existsSync(args.transcript)) {
    bail(`transcript file not found: ${args.transcript}`, "Check the --transcript path");
  }
  if (!existsSync(args.refDir)) {
    bail(`reference voice dir not found: ${args.refDir}`, "Check the --ref-dir path");
  }

  // 参照声ファイル読み込み
  const refLeftPath = resolve(args.refDir, `${args.leftId}.mp3`);
  const refRightPath = resolve(args.refDir, `${args.rightId}.mp3`);
  if (!existsSync(refLeftPath)) {
    bail(
      `reference voice not found: ${refLeftPath}`,
      `Place the reference voice for "${args.leftName}" as ${args.leftId}.mp3 in --ref-dir`,
    );
  }
  if (!existsSync(refRightPath)) {
    bail(
      `reference voice not found: ${refRightPath}`,
      `Place the reference voice for "${args.rightName}" as ${args.rightId}.mp3 in --ref-dir`,
    );
  }

  // transcript パース + 検証
  const transcriptRaw = await readFile(args.transcript, "utf-8");
  const segments = parseTranscriptText(transcriptRaw);
  if (segments.length === 0) {
    bail("transcript is empty or unparseable", "Check the transcript file format");
  }

  // multi-party ガード: transcript の unique speaker 数
  const uniqueSpeakers = new Set(segments.map((s) => s.speaker));
  if (uniqueSpeakers.size === 1) {
    bail(
      `transcript has only 1 unique speaker: ${[...uniqueSpeakers].join(", ")}`,
      "1 人モノローグは補正対象外 (誤判定が起きない)",
    );
  }
  if (uniqueSpeakers.size > 2) {
    bail(
      `transcript has ${uniqueSpeakers.size} unique speakers (multi-party not supported): ${[...uniqueSpeakers].join(", ")}`,
      "MVP は 2 人会議のみ対応。3 人以上は次フェーズで対応予定",
    );
  }

  // --left / --right の名前が transcript の speaker と一致するか
  if (!uniqueSpeakers.has(args.leftName)) {
    bail(
      `--left "${args.leftName}" not found in transcript speakers: ${[...uniqueSpeakers].join(", ")}`,
      "transcript の speaker と完全一致する名前を指定してください",
    );
  }
  if (!uniqueSpeakers.has(args.rightName)) {
    bail(
      `--right "${args.rightName}" not found in transcript speakers: ${[...uniqueSpeakers].join(", ")}`,
      "transcript の speaker と完全一致する名前を指定してください",
    );
  }

  const [refLeftBuf, refRightBuf] = await Promise.all([
    readFile(refLeftPath),
    readFile(refRightPath),
  ]);

  const referenceVoices: ReferenceVoice[] = [
    { id: args.leftId, displayLabel: args.leftName, audioBuffer: refLeftBuf },
    { id: args.rightId, displayLabel: args.rightName, audioBuffer: refRightBuf },
  ];

  const speakerMap = {
    nameToId: {
      [args.leftName]: args.leftId,
      [args.rightName]: args.rightId,
    },
    idToName: {
      [args.leftId]: args.leftName,
      [args.rightId]: args.rightName,
    },
    leftId: args.leftId,
    rightId: args.rightId,
  };

  // 実行情報を表示
  console.log("[correct-speakers] starting");
  console.log(`  video        : ${args.video}`);
  console.log(`  transcript   : ${args.transcript} (${segments.length} segments)`);
  console.log(`  ref-dir      : ${args.refDir}`);
  console.log(`  left         : ${args.leftName} (${args.leftId})`);
  console.log(`  right        : ${args.rightName} (${args.rightId})`);
  console.log(`  out          : ${args.out}`);
  if (args.limitSeconds !== undefined) console.log(`  limit-seconds: ${args.limitSeconds}`);
  if (args.skipFrames) console.log(`  skip-frames  : true (再利用)`);

  // 進捗表示
  let lastPhase = "";
  const onProgress = (phase: string, done: number, total: number): void => {
    if (phase !== lastPhase) {
      process.stdout.write(`\n[phase] ${phase} `);
      lastPhase = phase;
    }
    if (done === total) {
      process.stdout.write(` (${done}/${total} done)`);
    } else if (done % 10 === 0) {
      process.stdout.write(".");
    }
  };

  // orchestrator 実行
  let result: CorrectSpeakersOutput;
  try {
    result = await correctSpeakers({
      videoPath: args.video,
      segments,
      referenceVoices,
      speakerMap,
      geminiApiKey: geminiKey,
      workDir: args.workDir,
      options: {
        frameIntervalSec: 2,
        visionConcurrency: 5,
        audioConcurrency: 6,
        audioClipSec: 5,
        limitSeconds: args.limitSeconds,
        skipFrameExtraction: args.skipFrames,
        onProgress,
      },
    });
    process.stdout.write("\n");
  } catch (err) {
    process.stdout.write("\n");
    const msg = err instanceof Error ? err.message : String(err);
    bail(`correction failed: ${msg}`, "Check above logs for details", 2);
  }

  // corrections (diff だけ抜粋)
  const corrections: OutputCorrection[] = result.perSegment
    .filter((s) => s.verdict === "tldv-wrong" && s.correctedLabel !== s.tldvLabel)
    .map((s) => {
      const mm = String(Math.floor(s.startSec / 60)).padStart(2, "0");
      const ss = String(Math.floor(s.startSec) % 60).padStart(2, "0");
      return {
        idx: s.idx,
        time: `${mm}:${ss}`,
        originalLabel: s.tldvLabel,
        newLabel: s.correctedLabel,
        text: s.text,
      };
    });

  // 出力 JSON 組み立て
  const output: OutputJson = {
    videoPath: args.video,
    speakerMap: {
      left: { name: args.leftName, id: args.leftId },
      right: { name: args.rightName, id: args.rightId },
    },
    summary: {
      totalSegments: result.meta.totalSegments,
      correctedSegments: result.meta.correctedSegments,
      correctionConfidence: result.correctionConfidence,
      durationSec: result.meta.durationMs / 1000,
      visionFrames: result.meta.visionFrames,
      visionErrors: result.meta.visionErrors,
      audioCalls: result.meta.audioCalls,
      audioErrors: result.meta.audioErrors,
      audioFloorApplied: result.meta.audioFloorApplied,
    },
    correctedFullText: result.correctedFullText,
    corrections,
    perSegment: result.perSegment,
    meta: result.meta,
    generatedAt: new Date().toISOString(),
  };

  // 出力ファイル書き込み
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(output, null, 2), "utf-8");

  // サマリ表示
  console.log("\n=== Summary ===");
  console.log(`  total segments     : ${output.summary.totalSegments}`);
  console.log(`  corrected segments : ${output.summary.correctedSegments} (verdict=tldv-wrong)`);
  console.log(`  confidence         : ${output.summary.correctionConfidence.toFixed(3)}`);
  console.log(`  duration           : ${output.summary.durationSec.toFixed(1)} sec`);
  console.log(`  vision frames      : ${output.summary.visionFrames} (errors: ${output.summary.visionErrors})`);
  console.log(`  audio calls        : ${output.summary.audioCalls} (errors: ${output.summary.audioErrors})`);
  console.log(`  audio-floor applied: ${output.summary.audioFloorApplied}`);

  if (corrections.length > 0) {
    console.log("\n=== Corrected Labels ===");
    for (const c of corrections.slice(0, 10)) {
      const shortText = c.text.length > 40 ? c.text.slice(0, 40) + "..." : c.text;
      console.log(`  ${c.time}  ${c.originalLabel} → ${c.newLabel}  ${shortText}`);
    }
    if (corrections.length > 10) {
      console.log(`  ... and ${corrections.length - 10} more`);
    }
  }

  console.log(`\n[correct-speakers] saved: ${args.out}`);
  console.log(`[correct-speakers] basename: ${basename(args.out)}`);
}

main().catch((err) => {
  console.error("\n[correct-speakers] FATAL:", err);
  process.exit(2);
});
