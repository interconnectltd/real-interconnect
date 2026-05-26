// 3-way 判定 (tldv + video + audio) を多数決でマージし、
// 我々の PoC システム (video 補正) の真の精度を測定する
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/6-merge-3way.ts \
//     --transcript scripts/tldv-speaker-fix/samples/transcript.txt \
//     --video-timeline scripts/tldv-speaker-fix/output/speakers-10min.json \
//     --audio-verify scripts/tldv-speaker-fix/output/audio-verify.json \
//     --left-name "田島康平" --right-name "connect inter" \
//     --left-id tajima --right-id sara \
//     --out scripts/tldv-speaker-fix/output/3way-report.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface Args {
  transcript: string;
  videoTimeline: string;
  audioVerify: string;
  leftName: string;
  rightName: string;
  leftId: string;
  rightId: string;
  out: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    transcript: resolve(get("--transcript")!),
    videoTimeline: resolve(get("--video-timeline")!),
    audioVerify: resolve(get("--audio-verify")!),
    leftName: get("--left-name")!,
    rightName: get("--right-name")!,
    leftId: get("--left-id")!,
    rightId: get("--right-id")!,
    out: resolve(get("--out")!),
  };
}

interface Segment { speaker: string; startSec: number; text: string; }
function parseTranscript(raw: string): Segment[] {
  const out: Segment[] = [];
  for (const line of raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(.+?)\s+\[(\d{1,2}):(\d{2})\]:\s*(.*)$/);
    if (!m) continue;
    out.push({
      speaker: m[1].trim(),
      startSec: parseInt(m[2], 10) * 60 + parseInt(m[3], 10),
      text: m[4].trim(),
    });
  }
  return out;
}

interface VideoTimelineItem { timestampSec: number; speaker: "left" | "right" | "both" | "none" | "error"; }
function videoDominant(timeline: VideoTimelineItem[], startSec: number, endSec: number): "left" | "right" | "unknown" {
  const items = timeline.filter((t) => t.timestampSec >= startSec && t.timestampSec < endSec);
  let l = 0, r = 0;
  for (const it of items) { if (it.speaker === "left") l++; else if (it.speaker === "right") r++; }
  if (l === 0 && r === 0) return "unknown";
  if (l > r) return "left";
  if (r > l) return "right";
  return "unknown";
}

type NormalizedId = "tajima" | "sara" | "unknown";

async function main() {
  const args = parseArgs();

  const transcriptRaw = await readFile(args.transcript, "utf-8");
  const segments = parseTranscript(transcriptRaw);

  const videoData = JSON.parse(await readFile(args.videoTimeline, "utf-8")) as { items: VideoTimelineItem[] };
  const audioData = JSON.parse(await readFile(args.audioVerify, "utf-8")) as { items: { segmentIndex: number; speaker: "sara" | "tajima" | "unknown" | "error"; confidence: number }[] };
  const maxTimelineSec = Math.max(...videoData.items.map((t) => t.timestampSec));

  // 名前 → id にマッピング
  const nameToId: Record<string, NormalizedId> = {
    [args.leftName]: args.leftId as NormalizedId,
    [args.rightName]: args.rightId as NormalizedId,
  };
  const sideToId: Record<"left" | "right", NormalizedId> = {
    left: args.leftId as NormalizedId,
    right: args.rightId as NormalizedId,
  };

  type Verdict =
    | "all-agree"           // 3 つ全員一致 (tldv は正しいと推定)
    | "tldv-wrong"          // tldv が少数 (video + audio が一致して tldv と違う = tldv エラー確定)
    | "video-wrong"         // video が少数 (tldv + audio が一致)
    | "audio-wrong"         // audio が少数 (tldv + video が一致)
    | "all-disagree"        // 3 者 3 様
    | "with-unknown";       // unknown が含まれる

  interface Row {
    idx: number;
    time: string;
    startSec: number;
    endSec: number;
    text: string;
    tldv: NormalizedId;
    video: NormalizedId;
    audio: NormalizedId;
    audioConfidence: number;
    verdict: Verdict;
    trueSpeaker: NormalizedId | "ambiguous";
    pocCorrect: boolean | null; // 我々のシステム (video) が正しかったか
  }

  const rows: Row[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const endSec = Math.min(segments[i + 1]?.startSec ?? maxTimelineSec + 1, maxTimelineSec + 1);

    const tldv: NormalizedId = nameToId[seg.speaker] ?? "unknown";
    const videoSide = videoDominant(videoData.items, seg.startSec, endSec);
    const video: NormalizedId = videoSide === "unknown" ? "unknown" : sideToId[videoSide];
    const audioItem = audioData.items.find((a) => a.segmentIndex === i);
    const audio: NormalizedId = (audioItem?.speaker === "sara" || audioItem?.speaker === "tajima")
      ? (audioItem.speaker as NormalizedId)
      : "unknown";
    const audioConfidence = audioItem?.confidence ?? 0;

    // 多数決
    const hasUnknown = tldv === "unknown" || video === "unknown" || audio === "unknown";
    let verdict: Verdict;
    let trueSpeaker: NormalizedId | "ambiguous";
    let pocCorrect: boolean | null;

    if (hasUnknown) {
      verdict = "with-unknown";
      // 既知の2つが一致するなら真実とみなす
      const known = [tldv, video, audio].filter((x) => x !== "unknown");
      if (known.length >= 2 && known[0] === known[1]) {
        trueSpeaker = known[0];
        pocCorrect = video === trueSpeaker || video === "unknown";
      } else {
        trueSpeaker = "ambiguous";
        pocCorrect = null;
      }
    } else if (tldv === video && video === audio) {
      verdict = "all-agree";
      trueSpeaker = tldv;
      pocCorrect = true;
    } else if (tldv === video) {
      // audio だけ違う
      verdict = "audio-wrong";
      trueSpeaker = tldv;
      pocCorrect = true; // video は正解
    } else if (tldv === audio) {
      // video だけ違う = 我々のシステムの誤検出
      verdict = "video-wrong";
      trueSpeaker = tldv;
      pocCorrect = false;
    } else if (video === audio) {
      // tldv だけ違う = 我々が検出した本物の tldv エラー
      verdict = "tldv-wrong";
      trueSpeaker = video;
      pocCorrect = true;
    } else {
      verdict = "all-disagree";
      trueSpeaker = "ambiguous";
      pocCorrect = null;
    }

    const mm = String(Math.floor(seg.startSec / 60)).padStart(2, "0");
    const ss = String(seg.startSec % 60).padStart(2, "0");
    rows.push({
      idx: i,
      time: `${mm}:${ss}`,
      startSec: seg.startSec,
      endSec,
      text: seg.text,
      tldv, video, audio, audioConfidence,
      verdict, trueSpeaker, pocCorrect,
    });
  }

  // 集計
  const counts: Record<Verdict, number> = {
    "all-agree": 0, "tldv-wrong": 0, "video-wrong": 0, "audio-wrong": 0,
    "all-disagree": 0, "with-unknown": 0,
  };
  for (const r of rows) counts[r.verdict]++;

  // 精度指標
  const pocFlaggedSwap = rows.filter((r) => r.video !== r.tldv && r.tldv !== "unknown" && r.video !== "unknown").length;
  const pocConfirmedSwap = rows.filter((r) => r.verdict === "tldv-wrong").length; // 我々が flag、実際 tldv エラー
  const pocFalseAlarm = rows.filter((r) => r.verdict === "video-wrong").length;    // 我々が flag、実は tldv 正解
  const tldvTrueErrors = rows.filter((r) => r.verdict === "tldv-wrong").length;     // 真の tldv エラー件数 (確定)

  // 出力
  console.log("=" .repeat(110));
  console.log("3-WAY VERDICT TABLE");
  console.log("=" .repeat(110));
  console.log("idx  time   tldv     video    audio    verdict        真実       PoC正?  text");
  console.log("─" .repeat(110));
  for (const r of rows) {
    const v = r.verdict;
    const mark = r.pocCorrect === true ? "✓" : r.pocCorrect === false ? "✗" : "·";
    const verdictColor: Record<Verdict, string> = {
      "all-agree": "✓ all-agree",
      "tldv-wrong": "❌ TLDV WRONG",
      "video-wrong": "△ video-wrong",
      "audio-wrong": "△ audio-wrong",
      "all-disagree": "?? disagree",
      "with-unknown": "? unknown",
    };
    console.log(
      `${String(r.idx).padStart(3)}  ${r.time}  ${r.tldv.padEnd(8)} ${r.video.padEnd(8)} ${r.audio.padEnd(8)} ${verdictColor[v].padEnd(14)} ${String(r.trueSpeaker).padEnd(10)} ${mark}     ${r.text.slice(0, 30)}`,
    );
  }
  console.log("─" .repeat(110));

  console.log("\n=== Verdict Distribution ===");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(15)} ${v}件`);
  }

  console.log("\n=== Key Metrics ===");
  const total = rows.length;
  const tldvErrorRate = (tldvTrueErrors / total * 100).toFixed(1);
  console.log(`  全セグメント数:            ${total}`);
  console.log(`  PoC が "swap" と flag した:  ${pocFlaggedSwap} 件`);
  console.log(`    └ 本物の tldv エラー:    ${pocConfirmedSwap} 件 (PoC の True Positive)`);
  console.log(`    └ PoC の誤検出:           ${pocFalseAlarm} 件 (PoC の False Positive)`);
  console.log(`  tldv の真の誤判定率:        ${tldvErrorRate}% (確定分)`);
  console.log(`  PoC の precision:           ${pocFlaggedSwap > 0 ? (pocConfirmedSwap / pocFlaggedSwap * 100).toFixed(1) : "—"}%`);
  console.log(`     ↑ PoC が「swapだ」と言った中で本物のエラーだった割合`);

  // 出力 JSON
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    counts,
    metrics: {
      totalSegments: total,
      pocFlaggedSwap,
      pocConfirmedSwap,
      pocFalseAlarm,
      tldvTrueErrorCount: tldvTrueErrors,
      tldvTrueErrorRate: tldvTrueErrors / total,
      pocPrecision: pocFlaggedSwap > 0 ? pocConfirmedSwap / pocFlaggedSwap : null,
    },
    rows,
  }, null, 2), "utf-8");
  console.log(`\n[done] → ${args.out}`);
}

main().catch((e) => { console.error("[fatal]", e); process.exit(1); });
