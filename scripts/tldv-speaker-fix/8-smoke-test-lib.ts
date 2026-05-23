// PoC が出した既存 JSON を入力に、新 lib (src/lib/speaker-correction/) で再計算し、
// PoC 出力 (3way-report.json) と verdict 分布 + 各 row の verdict が一致するか確認。
//
// 期待される挙動:
//   1. lib は AUDIO_CONFIDENCE_FLOOR=0.6 で audio confidence が低いセグメントを
//      "unknown" に降格する → PoC との verdict 差異は「audio-floor 由来」のみ許容
//   2. それ以外の差異 = refactor の regression → exit code 1 で失敗
//
// 検証方法:
//   各セグメントで lib を 2 回呼ぶ:
//     - actual       : 通常呼び出し (floor 適用)
//     - actualNoFloor: audioConfidence=1.0 にして floor バイパス
//   - PoC と actual が一致     → unchanged
//   - PoC と actualNoFloor が一致 かつ audioConf<0.6 → floor-explained (意図差異)
//   - 上記いずれにも該当しない → regression (NG)
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/8-smoke-test-lib.ts \
//     --transcript     scripts/tldv-speaker-fix/samples/transcript.txt \
//     --video-timeline scripts/tldv-speaker-fix/output/speakers-10min.json \
//     --audio-verify   scripts/tldv-speaker-fix/output/audio-verify.json \
//     --expected       scripts/tldv-speaker-fix/output/3way-report.json \
//     [--verbose]

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AUDIO_CONFIDENCE_FLOOR,
  countVerdicts,
  fillEndSec,
  judgeSegment,
  parseTranscriptText,
  videoDominantInRange,
  type Segment,
  type SegmentJudgment,
  type Verdict,
  type VerdictResult,
  type VideoTimelineItem,
} from "../../src/lib/speaker-correction";

interface Args {
  transcript: string;
  videoTimeline: string;
  audioVerify: string;
  expected: string;
  verbose: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const transcript = get("--transcript");
  const videoTimeline = get("--video-timeline");
  const audioVerify = get("--audio-verify");
  const expected = get("--expected");
  if (!transcript || !videoTimeline || !audioVerify || !expected) {
    console.error(
      "Usage: --transcript <txt> --video-timeline <json> --audio-verify <json> --expected <json> [--verbose]",
    );
    process.exit(1);
  }
  return {
    transcript: resolve(transcript),
    videoTimeline: resolve(videoTimeline),
    audioVerify: resolve(audioVerify),
    expected: resolve(expected),
    verbose: argv.includes("--verbose"),
  };
}

// PoC 3way-report.json の row 1 件分
interface ExpectedRow {
  idx: number;
  time: string;
  startSec: number;
  endSec: number;
  text: string;
  tldv: string;
  video: string;
  audio: string;
  audioConfidence: number;
  verdict: Verdict;
  trueSpeaker: string;
  pocCorrect: boolean | null;
}

interface ExpectedReport {
  counts: Record<Verdict, number>;
  rows: ExpectedRow[];
}

interface AudioVerifyItem {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  transcriptSpeaker: string;
  speaker: string; // "sara" | "tajima" | "unknown" | "error"
  confidence: number;
}

// 本録画固有のマッピング (PoC と同じ)
const NAME_TO_ID: Record<string, string> = {
  "田島康平": "tajima",
  "connect inter": "sara",
};
const ID_TO_NAME: Record<string, string> = {
  tajima: "田島康平",
  sara: "connect inter",
};
const LEFT_ID = "tajima";
const RIGHT_ID = "sara";

function normalizeTldv(rawSpeaker: string): string {
  return NAME_TO_ID[rawSpeaker] ?? "unknown";
}

function videoSideToId(side: "left" | "right" | "unknown"): string {
  if (side === "left") return LEFT_ID;
  if (side === "right") return RIGHT_ID;
  return "unknown";
}

function normalizeAudio(raw: string): string {
  if (raw === "sara" || raw === "tajima") return raw;
  return "unknown"; // "error" や想定外の値も unknown 扱い
}

interface ActualRow {
  idx: number;
  time: string;
  tldv: string;
  video: string;
  audio: string;
  audioConfidence: number;
  actual: VerdictResult;
  actualNoFloor: VerdictResult;
}

interface RowDiff {
  idx: number;
  time: string;
  expected: Verdict;
  actual: Verdict;
  actualNoFloor: Verdict;
  cause: "audio-floor" | "regression";
  audioConfidence: number;
  tldv: string;
  video: string;
  audio: string;
}

async function main(): Promise<void> {
  const args = parseArgs();

  const [transcriptRaw, timelineRaw, audioRaw, expectedRaw] = await Promise.all([
    readFile(args.transcript, "utf-8"),
    readFile(args.videoTimeline, "utf-8"),
    readFile(args.audioVerify, "utf-8"),
    readFile(args.expected, "utf-8"),
  ]);

  const parsedSegs = parseTranscriptText(transcriptRaw);
  const timeline = (JSON.parse(timelineRaw) as { items: VideoTimelineItem[] }).items;
  const audioItems = (JSON.parse(audioRaw) as { items: AudioVerifyItem[] }).items;
  const expected = JSON.parse(expectedRaw) as ExpectedReport;

  // PoC と同じ「セグメント終端 = 次の startSec or maxTimelineSec+1」
  const maxTimelineSec = Math.max(...timeline.map((t) => t.timestampSec));
  const segments: Segment[] = fillEndSec(parsedSegs, maxTimelineSec + 1);

  if (segments.length !== expected.rows.length) {
    console.error(
      `[fatal] segment count mismatch: parsed=${segments.length} expected=${expected.rows.length}`,
    );
    process.exit(2);
  }

  console.log("[setup]", {
    transcriptSegs: segments.length,
    videoFrames: timeline.length,
    audioItems: audioItems.length,
    maxTimelineSec,
    AUDIO_CONFIDENCE_FLOOR,
  });

  // 各セグメントで lib を 2 回呼ぶ
  const actualRows: ActualRow[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const audio = audioItems.find((a) => a.segmentIndex === i);
    if (!audio) {
      console.error(`[fatal] audio item not found for segmentIndex=${i}`);
      process.exit(2);
    }
    const tldv = normalizeTldv(seg.speaker);
    const endSec = seg.endSec ?? maxTimelineSec + 1;
    const videoSide = videoDominantInRange(timeline, seg.startSec, endSec);
    const video = videoSideToId(videoSide);
    const audioNormalized = normalizeAudio(audio.speaker);

    const baseJudgment: SegmentJudgment = {
      tldv,
      video,
      audio: audioNormalized,
      audioConfidence: audio.confidence,
    };
    const actual = judgeSegment(baseJudgment);
    const actualNoFloor = judgeSegment({ ...baseJudgment, audioConfidence: 1.0 });

    const mm = String(Math.floor(seg.startSec / 60)).padStart(2, "0");
    const ss = String(Math.floor(seg.startSec) % 60).padStart(2, "0");
    actualRows.push({
      idx: i,
      time: `${mm}:${ss}`,
      tldv,
      video,
      audio: audioNormalized,
      audioConfidence: audio.confidence,
      actual,
      actualNoFloor,
    });
  }

  // 差分検出
  const diffs: RowDiff[] = [];
  for (const row of actualRows) {
    const exp = expected.rows[row.idx];
    if (!exp) continue;
    if (exp.verdict === row.actual.verdict) continue;

    const isFloorExplained =
      row.audioConfidence < AUDIO_CONFIDENCE_FLOOR &&
      exp.verdict === row.actualNoFloor.verdict;

    diffs.push({
      idx: row.idx,
      time: row.time,
      expected: exp.verdict,
      actual: row.actual.verdict,
      actualNoFloor: row.actualNoFloor.verdict,
      cause: isFloorExplained ? "audio-floor" : "regression",
      audioConfidence: row.audioConfidence,
      tldv: row.tldv,
      video: row.video,
      audio: row.audio,
    });
  }

  // verdict 分布
  const actualCounts = countVerdicts(actualRows.map((r) => r.actual));

  console.log("\n=== Verdict Distribution ===");
  const verdictKeys: Verdict[] = [
    "all-agree",
    "tldv-wrong",
    "video-wrong",
    "audio-wrong",
    "all-disagree",
    "with-unknown",
  ];
  console.log("  verdict        |  expected | actual | delta");
  console.log("  ---------------|----------|--------|------");
  for (const k of verdictKeys) {
    const e = expected.counts[k] ?? 0;
    const a = actualCounts[k];
    const delta = a - e;
    const sign = delta > 0 ? "+" : delta < 0 ? "" : " ";
    console.log(
      `  ${k.padEnd(14)} | ${String(e).padStart(8)} | ${String(a).padStart(6)} | ${sign}${delta}`,
    );
  }

  // per-row diff
  const floorExplained = diffs.filter((d) => d.cause === "audio-floor").length;
  const regressions = diffs.filter((d) => d.cause === "regression").length;

  if (diffs.length > 0 || args.verbose) {
    console.log("\n=== Per-row Diff ===");
    for (const d of diffs) {
      const tag = d.cause === "audio-floor" ? "✓ floor-explained" : "❌ REGRESSION";
      console.log(
        `  idx=${String(d.idx).padStart(2)} time=${d.time}  ` +
          `expected=${d.expected.padEnd(14)} actual=${d.actual.padEnd(14)} ` +
          `(noFloor=${d.actualNoFloor})  ` +
          `audioConf=${d.audioConfidence.toFixed(2)}  ` +
          `tldv=${d.tldv} video=${d.video} audio=${d.audio}  ${tag}`,
      );
    }
  }

  // フッタ
  console.log("\n=== Summary ===");
  console.log(`  total segments      : ${segments.length}`);
  console.log(`  changed verdicts    : ${diffs.length}`);
  console.log(`  floor-explained (OK): ${floorExplained}`);
  console.log(`  regressions (NG)    : ${regressions}`);

  // 一応 ID_TO_NAME が未使用変数にならないよう保険ログ
  if (args.verbose) {
    console.log(`  speaker map         : ${JSON.stringify(ID_TO_NAME)}`);
  }

  if (regressions === 0) {
    console.log("\n✅ PASS: lib は PoC と挙動一致 (audio-floor 由来の差異のみ)");
    process.exit(0);
  } else {
    console.log("\n❌ FAIL: regression あり (lib の修正が必要)");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(2);
});
