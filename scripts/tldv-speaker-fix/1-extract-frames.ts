// tldv の画面録画 mp4 から N 秒ごとにフレームを切り出す (PoC)
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/1-extract-frames.ts \
//     --input scripts/tldv-speaker-fix/samples/sample-meeting.mp4 \
//     --out   scripts/tldv-speaker-fix/frames \
//     --every 2 \
//     [--limit-seconds 180]   # 最初の N 秒だけ処理したいとき (PoC 用)
//
// 出力: frames/frame_00001.jpg, frame_00002.jpg, ...
//       frame_NNNNN.jpg ↔ 動画内タイムスタンプ (NNNNN - 1) * every 秒
//
// メモ:
//   - 元動画は 720p / 18fps なのでそのまま jpg 出力 (再エンコードなし、ストリームコピー不可なので品質指定のみ)
//   - 品質は -q:v 5 (1=最高〜31=最低の中で見やすさとサイズの折衷)
//   - Gemini Flash Lite に渡すには 720p で十分 (active speaker 検出が目的)

import { spawn } from "node:child_process";
import { mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface Args {
  input: string;
  out: string;
  every: number;
  limitSeconds?: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--input");
  const out = get("--out");
  if (!input || !out) {
    console.error("Usage: --input <mp4> --out <dir> [--every <sec>] [--limit-seconds <sec>]");
    process.exit(1);
  }
  return {
    input: resolve(input),
    out: resolve(out),
    every: Number(get("--every") ?? 2),
    limitSeconds: get("--limit-seconds") ? Number(get("--limit-seconds")) : undefined,
  };
}

async function probeDuration(input: string): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      input,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", rej);
    p.on("close", (code) => {
      if (code === 0) res(parseFloat(out.trim()));
      else rej(new Error(`ffprobe exited ${code}`));
    });
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
    p.on("error", rej);
    p.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`ffmpeg exited ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs();

  if (!existsSync(args.input)) {
    throw new Error(`input not found: ${args.input}`);
  }

  // 出力先を空にして再現性を担保
  await rm(args.out, { recursive: true, force: true });
  await mkdir(args.out, { recursive: true });

  const totalDuration = await probeDuration(args.input);
  const effectiveDuration = args.limitSeconds
    ? Math.min(args.limitSeconds, totalDuration)
    : totalDuration;
  const expectedFrames = Math.floor(effectiveDuration / args.every);

  console.log("[info]", {
    input: args.input,
    out: args.out,
    everySec: args.every,
    totalDuration: totalDuration.toFixed(1) + "s",
    effectiveDuration: effectiveDuration.toFixed(1) + "s",
    expectedFrames,
  });

  const ffmpegArgs = [
    "-y",
    "-i", args.input,
    ...(args.limitSeconds ? ["-t", String(args.limitSeconds)] : []),
    "-vf", `fps=1/${args.every}`,
    "-q:v", "5",
    `${args.out}/frame_%05d.jpg`,
  ];

  console.log("[run] ffmpeg", ffmpegArgs.join(" "));
  const t0 = Date.now();
  await runFfmpeg(ffmpegArgs);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const files = (await readdir(args.out)).filter((f) => f.endsWith(".jpg"));
  console.log(`[done] ${files.length} frames in ${elapsed}s`);
  console.log(`       first: ${files[0]}  →  timestamp 0s`);
  console.log(
    `       last:  ${files[files.length - 1]}  →  timestamp ${(files.length - 1) * args.every}s`,
  );
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
