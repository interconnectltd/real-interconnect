// ffmpeg / ffprobe ラッパー。
// PoC では `1-extract-frames.ts` / `5-verify-voice.ts` に分散していた。

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

export async function probeDuration(videoPath: string): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
    });
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

export interface ExtractFramesOptions {
  /** mp4 等の入力動画 */
  input: string;
  /** 出力ディレクトリ (中身は事前に空にされる) */
  outDir: string;
  /** N 秒ごとに 1 フレーム */
  everySec: number;
  /** 最初の N 秒だけ処理 (テスト用) */
  limitSeconds?: number;
}

/**
 * 動画から N 秒ごとに JPG を抽出。`frame_NNNNN.jpg` という命名で、
 * `(NNNNN - 1) * everySec` 秒の位置のフレームに対応。
 * 720p / -q:v 5 (画質 vs サイズの折衷) で固定。Gemini Flash Lite には十分。
 */
export async function extractFrames(opts: ExtractFramesOptions): Promise<{
  frameCount: number;
  durationSec: number;
}> {
  const duration = await probeDuration(opts.input);
  const effectiveDuration = opts.limitSeconds ? Math.min(opts.limitSeconds, duration) : duration;

  // 出力先を空にして再現性を担保
  await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(opts.outDir, { recursive: true });

  await runFfmpeg([
    "-y",
    "-i",
    opts.input,
    ...(opts.limitSeconds ? ["-t", String(opts.limitSeconds)] : []),
    "-vf",
    `fps=1/${opts.everySec}`,
    "-q:v",
    "5",
    `${opts.outDir}/frame_%05d.jpg`,
  ]);

  const frameCount = Math.floor(effectiveDuration / opts.everySec);
  return { frameCount, durationSec: effectiveDuration };
}

/**
 * 動画から音声区間を mp3 バッファとして抽出。ストリーミングで stdout から
 * 受け取るため一時ファイルを作らない。声紋照合用に 16kHz / mono / 32kbps。
 */
export async function extractAudioClip(opts: {
  video: string;
  startSec: number;
  durationSec: number;
}): Promise<Buffer> {
  return new Promise((res, rej) => {
    const p = spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(opts.startSec),
        "-t",
        String(opts.durationSec),
        "-i",
        opts.video,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "32k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", rej);
    p.on("close", (code) => {
      if (code === 0) res(Buffer.concat(chunks));
      else rej(new Error(`ffmpeg exited ${code}`));
    });
  });
}

/**
 * 動画の特定タイムスタンプの単一フレームを JPG バッファとして抽出 (一時ファイル無し)。
 * 「セグメント内に 3 枚」のように動的フレーム取得をする場合用。
 */
export async function extractSingleFrame(opts: {
  video: string;
  timestampSec: number;
}): Promise<Buffer> {
  return new Promise((res, rej) => {
    const p = spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(opts.timestampSec),
        "-i",
        opts.video,
        "-frames:v",
        "1",
        "-q:v",
        "5",
        "-f",
        "image2",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", rej);
    p.on("close", (code) => {
      if (code === 0) res(Buffer.concat(chunks));
      else rej(new Error(`ffmpeg exited ${code}`));
    });
  });
}
