// tldv transcript の話者ラベルと、Gemini 画面解析の active speaker timeline を突き合わせて
// 「話者がスワップしている疑いがあるセグメント」を炙り出す
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/4-compare.ts \
//     --transcript scripts/tldv-speaker-fix/samples/transcript.txt \
//     --timeline   scripts/tldv-speaker-fix/output/speakers-3min.json \
//     --left       "田島康平" \
//     --right      "connect inter"
//
// マッピング:
//   --left   tldv での話者名 → 映像の "左タイル" にいる人
//   --right  tldv での話者名 → 映像の "右タイル" にいる人

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Args { transcript: string; timeline: string; left: string; right: string; }

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const transcript = get("--transcript");
  const timeline = get("--timeline");
  const left = get("--left");
  const right = get("--right");
  if (!transcript || !timeline || !left || !right) {
    console.error("Usage: --transcript <txt> --timeline <json> --left <name> --right <name>");
    process.exit(1);
  }
  return { transcript: resolve(transcript), timeline: resolve(timeline), left, right };
}

interface Segment { speaker: string; startSec: number; text: string; }

function parseTranscript(raw: string): Segment[] {
  // 形式: "<name> [MM:SS]: <text>"  (改行で区切られる)
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const segs: Segment[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\s+\[(\d{1,2}):(\d{2})\]:\s*(.*)$/);
    if (!m) continue;
    const [, speaker, mm, ss, text] = m;
    const startSec = parseInt(mm, 10) * 60 + parseInt(ss, 10);
    segs.push({ speaker: speaker.trim(), startSec, text: text.trim() });
  }
  return segs;
}

interface TimelineItem { timestampSec: number; speaker: "left" | "right" | "both" | "none" | "error"; confidence: number; }

// セグメント [startSec, endSec) に該当する timeline 項目から、多数決で「映像が示す話者」を決める
function dominantSpeaker(timeline: TimelineItem[], startSec: number, endSec: number): {
  speaker: "left" | "right" | "both" | "none" | "error";
  counts: Record<string, number>;
  sample: number;
} {
  const items = timeline.filter((t) => t.timestampSec >= startSec && t.timestampSec < endSec);
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.speaker] = (counts[it.speaker] ?? 0) + 1;
  // none / error は補助扱い、left/right を優先して多数決
  const priority: Array<TimelineItem["speaker"]> = ["left", "right", "both", "none", "error"];
  let best: TimelineItem["speaker"] = "none";
  let bestCount = -1;
  for (const k of priority) {
    if ((counts[k] ?? 0) > bestCount && (k === "left" || k === "right" || k === "both")) {
      best = k;
      bestCount = counts[k] ?? 0;
    }
  }
  if (bestCount <= 0) best = (counts["none"] ?? 0) > 0 ? "none" : "error";
  return { speaker: best, counts, sample: items.length };
}

async function main() {
  const args = parseArgs();

  const transcriptRaw = await readFile(args.transcript, "utf-8");
  const segments = parseTranscript(transcriptRaw);

  const timelineRaw = await readFile(args.timeline, "utf-8");
  const timeline = (JSON.parse(timelineRaw) as { items: TimelineItem[] }).items;
  const maxTimelineSec = Math.max(...timeline.map((t) => t.timestampSec));

  const sideToName = { left: args.left, right: args.right } as const;

  console.log("=== Speaker Swap Detection ===");
  console.log(`mapping: left=${args.left}  right=${args.right}`);
  console.log(`timeline covers 0 - ${maxTimelineSec}s`);
  console.log(`transcript segments: ${segments.length}\n`);

  // セグメントの終了 = 次のセグメントの開始 (最後は timeline 末尾まで)
  let mismatch = 0;
  let match = 0;
  let skipped = 0;

  console.log("time   transcript-said   video-said       verdict  text(...30文字)");
  console.log("─".repeat(90));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const nextStart = segments[i + 1]?.startSec ?? maxTimelineSec + 1;
    const endSec = Math.min(nextStart, maxTimelineSec + 1);

    // timeline の範囲外はスキップ
    if (seg.startSec > maxTimelineSec) { skipped++; continue; }

    const dom = dominantSpeaker(timeline, seg.startSec, endSec);
    const videoSide = dom.speaker;
    const videoName = videoSide === "left" || videoSide === "right" ? sideToName[videoSide] : "—";
    const said = seg.speaker;

    const mm = String(Math.floor(seg.startSec / 60)).padStart(2, "0");
    const ss = String(seg.startSec % 60).padStart(2, "0");
    const time = `${mm}:${ss}`;

    let verdict: string;
    if (videoSide === "none" || videoSide === "error" || videoSide === "both") {
      verdict = "?";
      skipped++;
    } else if (videoName === said) {
      verdict = "✓";
      match++;
    } else {
      verdict = "❌ SWAP";
      mismatch++;
    }

    const shortText = seg.text.slice(0, 30).replace(/\n/g, " ");
    console.log(`${time}  ${said.padEnd(16)} ${videoName.padEnd(16)} ${verdict.padEnd(8)} ${shortText}`);
  }

  console.log("─".repeat(90));
  console.log(`\n結果: match=${match}  mismatch=${mismatch}  skipped/unclear=${skipped}`);
  console.log(`誤判定率: ${mismatch}/${match + mismatch} = ${((mismatch / Math.max(1, match + mismatch)) * 100).toFixed(0)}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
