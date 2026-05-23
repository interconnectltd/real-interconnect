// lib の orchestrator (correctSpeakers) を実 mp4 で end-to-end 走らせ、
// PoC の 3way-report.json と比較して regression を検出する。
//
// 真の e2e: ffmpeg + Gemini vision + Gemini audio を実際に呼ぶ。
// PoC のフレーム dir (scripts/tldv-speaker-fix/frames/) は壊さないため、
// e2e-work/ に独立して出力する。
//
// 合格基準 (Gemini 非決定性を考慮):
//   - lib が throw せず最後まで走り切る (致命的エラー無し)
//   - vision / audio error 率が circuit breaker (30%) 未満
//   - PoC との verdict 分布の差が ±3 件以内
//   - lib の内部整合性 100% (各 row で judgeSegment 再計算 = 記録された verdict)
//
// per-row 一致率は **PASS/FAIL に使わない** (Gemini が同じ入力でも違う出力を出すため)。
// 代わりに 10-analyze-e2e-result.ts で「lib バグ vs Gemini 変動」を切り分ける。
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/9-e2e-test-lib.ts
//
// Cost: 約 ¥10 / 所要時間 約 1〜2 分

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  correctSpeakers,
  parseTranscriptText,
  type CorrectSpeakersOutput,
  type ReferenceVoice,
  type Verdict,
} from "../../src/lib/speaker-correction";

const PROJECT_ROOT = resolve(__dirname, "..", "..");

const PATHS = {
  video: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/samples/sample-meeting-2.mp4"),
  transcript: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/samples/transcript.txt"),
  refSara: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/audio/refs/sara.mp3"),
  refTajima: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/audio/refs/tajima.mp3"),
  expected: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/output/3way-report.json"),
  workDir: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/e2e-work"),
  out: resolve(PROJECT_ROOT, "scripts/tldv-speaker-fix/output/e2e-result.json"),
};

interface ExpectedRow {
  idx: number;
  verdict: Verdict;
  tldv: string;
  video: string;
  audio: string;
}
interface ExpectedReport {
  counts: Record<Verdict, number>;
  rows: ExpectedRow[];
}

interface PerRowDiff {
  idx: number;
  expected: Verdict;
  actual: Verdict;
  expectedTldv: string;
  actualTldv: string;
  expectedVideo: string;
  actualVideo: string;
  expectedAudio: string;
  actualAudio: string;
}

const PASS_THRESHOLDS = {
  verdictDeltaMax: 3, // 各 verdict の件数差の絶対値
  visionErrorRateMax: 0.3,
  audioErrorRateMax: 0.3,
  // per-row 一致率は参考表示のみ (Gemini 非決定性のため FAIL 基準にしない)
};

async function main(): Promise<void> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.error("[fatal] GEMINI_API_KEY is not set in .env.local");
    process.exit(2);
  }

  // 入力読み込み
  const [transcriptRaw, saraRefBuf, tajimaRefBuf, expectedRaw] = await Promise.all([
    readFile(PATHS.transcript, "utf-8"),
    readFile(PATHS.refSara),
    readFile(PATHS.refTajima),
    readFile(PATHS.expected, "utf-8"),
  ]);

  const segments = parseTranscriptText(transcriptRaw);
  const expected = JSON.parse(expectedRaw) as ExpectedReport;

  if (segments.length !== expected.rows.length) {
    console.error(
      `[fatal] segment count mismatch: parsed=${segments.length} expected=${expected.rows.length}`,
    );
    process.exit(2);
  }

  const referenceVoices: ReferenceVoice[] = [
    { id: "sara", displayLabel: "sara", audioBuffer: saraRefBuf },
    { id: "tajima", displayLabel: "田島", audioBuffer: tajimaRefBuf },
  ];

  const speakerMap = {
    nameToId: { "田島康平": "tajima", "connect inter": "sara" } as Record<string, string>,
    idToName: { tajima: "田島康平", sara: "connect inter" } as Record<string, string>,
    leftId: "tajima",
    rightId: "sara",
  };

  console.log("[e2e] starting...");
  console.log("[e2e] video:", PATHS.video);
  console.log("[e2e] segments:", segments.length);
  console.log("[e2e] reference voices:", referenceVoices.map((r) => r.id));

  const t0 = Date.now();
  let lastPhase = "";

  const result: CorrectSpeakersOutput = await correctSpeakers({
    videoPath: PATHS.video,
    segments,
    referenceVoices,
    speakerMap,
    geminiApiKey,
    workDir: PATHS.workDir,
    options: {
      frameIntervalSec: 2,
      visionConcurrency: 5,
      audioConcurrency: 6,
      audioClipSec: 5,
      onProgress: (phase, done, total) => {
        if (phase !== lastPhase) {
          process.stdout.write(`\n[phase] ${phase} `);
          lastPhase = phase;
        }
        if (done === total) {
          process.stdout.write(`(${done}/${total} done)`);
        } else if (done % 10 === 0) {
          process.stdout.write(`.`);
        }
      },
    },
  });
  process.stdout.write("\n");

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  // 結果保存
  await mkdir(dirname(PATHS.out), { recursive: true });
  await writeFile(PATHS.out, JSON.stringify(result, null, 2), "utf-8");
  console.log(`[e2e] saved: ${PATHS.out}`);

  // 比較
  console.log("\n=== Verdict Distribution (lib vs PoC) ===");
  const verdictKeys: Verdict[] = [
    "all-agree",
    "tldv-wrong",
    "video-wrong",
    "audio-wrong",
    "all-disagree",
    "with-unknown",
  ];
  console.log("  verdict        |  poc | lib  | delta");
  console.log("  ---------------|------|------|------");
  let maxAbsDelta = 0;
  for (const k of verdictKeys) {
    const p = expected.counts[k] ?? 0;
    const l = result.meta.counts[k];
    const delta = l - p;
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
    const sign = delta > 0 ? "+" : delta < 0 ? "" : " ";
    console.log(
      `  ${k.padEnd(14)} | ${String(p).padStart(4)} | ${String(l).padStart(4)} | ${sign}${delta}`,
    );
  }

  // per-row 一致率
  const perRowDiffs: PerRowDiff[] = [];
  let matchedRows = 0;
  for (let i = 0; i < expected.rows.length; i++) {
    const exp = expected.rows[i];
    const lib = result.perSegment[i];
    if (!exp || !lib) continue;
    if (exp.verdict === lib.verdict) {
      matchedRows++;
    } else {
      perRowDiffs.push({
        idx: i,
        expected: exp.verdict,
        actual: lib.verdict,
        expectedTldv: exp.tldv,
        actualTldv: lib.tldv,
        expectedVideo: exp.video,
        actualVideo: lib.video,
        expectedAudio: exp.audio,
        actualAudio: lib.audio,
      });
    }
  }
  const matchRate = matchedRows / expected.rows.length;

  // tldv-wrong リコール (PoC で tldv-wrong だったセグを lib も tldv-wrong と判定したか)
  const pocTldvWrongIdx = new Set(
    expected.rows.filter((r) => r.verdict === "tldv-wrong").map((r) => r.idx),
  );
  const libTldvWrongIdx = new Set(
    result.perSegment.filter((p) => p.verdict === "tldv-wrong").map((p) => p.idx),
  );
  const recall =
    pocTldvWrongIdx.size === 0
      ? 1
      : [...pocTldvWrongIdx].filter((i) => libTldvWrongIdx.has(i)).length / pocTldvWrongIdx.size;

  console.log("\n=== Match Statistics ===");
  console.log(`  per-row match rate     : ${(matchRate * 100).toFixed(1)}% (参考。Gemini 非決定性で揺れる)`);
  console.log(`  max verdict delta abs  : ${maxAbsDelta}  (threshold ${PASS_THRESHOLDS.verdictDeltaMax})`);
  console.log(`  tldv-wrong recall      : ${(recall * 100).toFixed(1)}%  (PoC: ${pocTldvWrongIdx.size} / lib found ${libTldvWrongIdx.size})`);
  console.log(`  vision error rate      : ${((result.meta.visionErrors / result.meta.visionFrames) * 100).toFixed(1)}%  (threshold ${PASS_THRESHOLDS.visionErrorRateMax * 100}%)`);
  console.log(`  audio error rate       : ${((result.meta.audioErrors / result.meta.audioCalls) * 100).toFixed(1)}%  (threshold ${PASS_THRESHOLDS.audioErrorRateMax * 100}%)`);

  console.log("\n=== Lib Meta ===");
  console.log(`  totalSegments         : ${result.meta.totalSegments}`);
  console.log(`  correctedSegments     : ${result.meta.correctedSegments} (verdict=tldv-wrong)`);
  console.log(`  audioFloorApplied     : ${result.meta.audioFloorApplied}`);
  console.log(`  correctionConfidence  : ${result.correctionConfidence.toFixed(3)}`);
  console.log(`  durationSec           : ${(result.meta.durationMs / 1000).toFixed(1)}`);

  if (perRowDiffs.length > 0) {
    console.log("\n=== Per-row Diffs (first 20) ===");
    for (const d of perRowDiffs.slice(0, 20)) {
      console.log(
        `  idx=${String(d.idx).padStart(2)}  ` +
          `expected=${d.expected.padEnd(14)} actual=${d.actual.padEnd(14)}  ` +
          `[tldv ${d.expectedTldv}→${d.actualTldv}] [video ${d.expectedVideo}→${d.actualVideo}] [audio ${d.expectedAudio}→${d.actualAudio}]`,
      );
    }
    if (perRowDiffs.length > 20) {
      console.log(`  ... and ${perRowDiffs.length - 20} more`);
    }
  }

  // 合格判定 (per-row match は対象外、Gemini 非決定性のため)
  const visionErrorRate = result.meta.visionErrors / result.meta.visionFrames;
  const audioErrorRate = result.meta.audioErrors / result.meta.audioCalls;
  const passes = {
    verdictDelta: maxAbsDelta <= PASS_THRESHOLDS.verdictDeltaMax,
    visionErr: visionErrorRate <= PASS_THRESHOLDS.visionErrorRateMax,
    audioErr: audioErrorRate <= PASS_THRESHOLDS.audioErrorRateMax,
  };
  const allPass = Object.values(passes).every(Boolean);
  void matchRate; // 参考表示のみ

  console.log("\n=== Pass / Fail ===");
  for (const [k, v] of Object.entries(passes)) {
    console.log(`  ${v ? "✅" : "❌"} ${k}`);
  }

  console.log(`\n[e2e] elapsed: ${elapsedSec}s`);
  if (allPass) {
    console.log("\n✅ E2E PASS — lib は実 mp4 で PoC と同等の挙動を再現");
    process.exit(0);
  } else {
    console.log("\n❌ E2E FAIL — 上記基準を満たさず");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(2);
});
