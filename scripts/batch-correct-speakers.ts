// 3-way speaker correction バッチ処理 (Day 4d)
//
// --input-dir 内の `*.mp4` を順次走査し、各ファイルに対して
// `pnpm correct-speakers -- --video <path> --write-db --skip-already-corrected ...`
// を実行する。
//
// 失敗は log に残して続行 (resilient)。連続失敗が --max-consecutive-failures
// を超えると自動停止 (Gemini quota / network 障害の long-tail を想定)。
//
// === 使い方 ===
//
//   # 基本
//   pnpm batch-correct-speakers -- --input-dir ~/tldv-downloads
//
//   # ドライラン (各ファイルで --dry-run、DB 触らない)
//   pnpm batch-correct-speakers -- --input-dir ~/tldv-downloads --dry-run
//
//   # 既に補正済みも強制再処理
//   pnpm batch-correct-speakers -- --input-dir ~/tldv-downloads --force-reprocess
//
//   # コスト見積もり確認スキップ
//   pnpm batch-correct-speakers -- --input-dir ~/tldv-downloads --yes

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

interface BatchArgs {
  inputDir: string;
  reportPath: string;
  dryRun: boolean;
  forceReprocess: boolean;
  forceOverwrite: boolean;
  noReAnalyze: boolean;
  maxConsecutiveFailures: number;
  maxFiles?: number;
  yes: boolean;
  verbose: boolean;
}

function parseArgs(): BatchArgs {
  const argv = process.argv.slice(2);
  const get = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (f: string): boolean => argv.includes(f);

  const inputDir = get("--input-dir") ?? `${homedir()}/tldv-downloads`;
  const reportPath = get("--report") ?? "./batch-report.json";

  return {
    inputDir: resolve(inputDir),
    reportPath: resolve(reportPath),
    dryRun: has("--dry-run"),
    forceReprocess: has("--force-reprocess"),
    forceOverwrite: has("--force-overwrite"),
    noReAnalyze: has("--no-re-analyze"),
    maxConsecutiveFailures: Number(get("--max-consecutive-failures") ?? 5),
    maxFiles: get("--max-files") ? Number(get("--max-files")) : undefined,
    yes: has("--yes"),
    verbose: has("--verbose"),
  };
}

function bail(msg: string, hint?: string, exitCode: 1 | 2 = 1): never {
  console.error(`[batch] ERROR: ${msg}`);
  if (hint) console.error(`  hint: ${hint}`);
  process.exit(exitCode);
}

// ──────────────────────────────────────────────────────────────────
// ファイル列挙 + コスト見積もり
// ──────────────────────────────────────────────────────────────────

interface CandidateFile {
  path: string;
  basename: string;
  sizeMb: number;
  estDurationSec: number;
  estCostYen: number;
}

/** 720p mp4 のサイズ MB → おおよその長さ秒 (経験則: 1MB ≈ 1.5 秒) */
function estimateDurationSec(sizeMb: number): number {
  return sizeMb / 1.5;
}

/** 1 ミーティングの推定 Gemini コスト (円) */
function estimateCostYen(durationSec: number): number {
  const visionFrames = durationSec / 2; // every 2s
  const audioSegments = durationSec / 10; // 経験則
  return visionFrames * 0.04 + audioSegments * 0.5;
}

async function listCandidates(inputDir: string): Promise<CandidateFile[]> {
  if (!existsSync(inputDir)) {
    bail(`input dir not found: ${inputDir}`, "Specify --input-dir or create the directory first");
  }
  const entries = await readdir(inputDir);
  const mp4s = entries.filter((f) => /\.mp4$/i.test(f) && !f.startsWith("."));
  if (mp4s.length === 0) {
    bail(`no .mp4 files found in ${inputDir}`, "Drop your downloaded mp4 files here");
  }

  const out: CandidateFile[] = [];
  for (const name of mp4s.sort()) {
    const filepath = resolve(inputDir, name);
    const st = await stat(filepath);
    const sizeMb = st.size / 1024 / 1024;
    const dur = estimateDurationSec(sizeMb);
    out.push({
      path: filepath,
      basename: name,
      sizeMb,
      estDurationSec: dur,
      estCostYen: estimateCostYen(dur),
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// CLI 起動 (spawn)
// ──────────────────────────────────────────────────────────────────

interface SpawnResult {
  exitCode: number | null;
  durationMs: number;
}

async function spawnCorrect(args: BatchArgs, videoPath: string): Promise<SpawnResult> {
  const t0 = Date.now();
  return new Promise((resolveP) => {
    const spawnArgs = [
      "correct-speakers",
      "--",
      "--video",
      videoPath,
      "--write-db",
      "--auto-pick-first",
    ];
    if (args.dryRun) spawnArgs.push("--dry-run");
    if (!args.forceReprocess) spawnArgs.push("--skip-already-corrected");
    if (args.forceOverwrite) spawnArgs.push("--force-overwrite");
    if (args.noReAnalyze) spawnArgs.push("--no-re-analyze");

    const p = spawn("pnpm", spawnArgs, { stdio: args.verbose ? "inherit" : "ignore" });
    p.on("error", () => resolveP({ exitCode: -1, durationMs: Date.now() - t0 }));
    p.on("exit", (code) => resolveP({ exitCode: code, durationMs: Date.now() - t0 }));
  });
}

// ──────────────────────────────────────────────────────────────────
// レポート
// ──────────────────────────────────────────────────────────────────

interface FileResult {
  file: string;
  basename: string;
  status: "succeeded" | "failed";
  exitCode: number | null;
  durationSec: number;
  startedAt: string;
  finishedAt: string;
}

interface BatchReport {
  startedAt: string;
  completedAt: string;
  inputDir: string;
  dryRun: boolean;
  total: number;
  succeeded: number;
  failed: number;
  abortReason?: string;
  interrupted?: boolean;
  results: FileResult[];
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

// ──────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  console.log("[batch] starting batch-correct-speakers");
  console.log(`  input-dir: ${args.inputDir}`);
  console.log(`  report   : ${args.reportPath}`);
  console.log(`  dry-run  : ${args.dryRun}`);
  console.log(`  resume   : ${!args.forceReprocess} (skip-already-corrected)`);

  const candidates = await listCandidates(args.inputDir);
  const limited = args.maxFiles ? candidates.slice(0, args.maxFiles) : candidates;

  const totalCostMin = limited.reduce((a, c) => a + c.estCostYen, 0);
  const totalCostMax = totalCostMin * 1.5; // 経験則の上振れ
  const totalDurSec = limited.reduce((a, c) => a + c.estDurationSec, 0);

  console.log(`\n[batch] files to process: ${limited.length}`);
  console.log(`  est. total video length : ${formatDuration(totalDurSec * 1000)}`);
  console.log(`  est. total cost         : ¥${totalCostMin.toFixed(0)} 〜 ¥${totalCostMax.toFixed(0)}`);
  console.log(`  est. wall clock         : ${formatDuration(limited.length * 15 * 60 * 1000)} (15min/file 想定)`);

  // 確認 (TTY only, --yes でスキップ)
  if (!args.yes && stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const ans = await rl.question(`\nProceed? (y/N): `);
      if (!/^y/i.test(ans.trim())) {
        console.log("[batch] aborted by user");
        process.exit(0);
      }
    } finally {
      rl.close();
    }
  }

  // SIGINT ハンドリング (1 回目で graceful、2 回目で hard kill)
  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) {
      console.error("\n[batch] hard kill requested, terminating now");
      process.exit(130);
    }
    interrupted = true;
    console.error("\n[batch] interrupt received, finishing current file then stopping...");
  });

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const results: FileResult[] = [];
  let consecutiveFailures = 0;
  let abortReason: string | undefined;

  for (let i = 0; i < limited.length; i++) {
    if (interrupted) {
      abortReason = "interrupted";
      break;
    }
    if (consecutiveFailures >= args.maxConsecutiveFailures) {
      abortReason = `${consecutiveFailures} consecutive failures (max: ${args.maxConsecutiveFailures})`;
      break;
    }

    const file = limited[i];
    if (!file) continue;
    const fileStartedAt = new Date().toISOString();
    const elapsedSoFar = Date.now() - t0;
    const avgPerFile = i > 0 ? elapsedSoFar / i : 15 * 60 * 1000;
    const etaMs = (limited.length - i) * avgPerFile;

    process.stdout.write(
      `[${i + 1}/${limited.length}] ${file.basename} ... `,
    );

    const res = await spawnCorrect(args, file.path);
    const success = res.exitCode === 0;

    const result: FileResult = {
      file: file.path,
      basename: file.basename,
      status: success ? "succeeded" : "failed",
      exitCode: res.exitCode,
      durationSec: res.durationMs / 1000,
      startedAt: fileStartedAt,
      finishedAt: new Date().toISOString(),
    };
    results.push(result);

    if (success) {
      consecutiveFailures = 0;
      console.log(`✓ done in ${formatDuration(res.durationMs)} | ETA: ${formatDuration(etaMs)}`);
    } else {
      consecutiveFailures++;
      console.log(`✗ FAILED (exit ${res.exitCode}) | consec=${consecutiveFailures}/${args.maxConsecutiveFailures}`);
    }
  }

  const completedAt = new Date().toISOString();
  const report: BatchReport = {
    startedAt,
    completedAt,
    inputDir: args.inputDir,
    dryRun: args.dryRun,
    total: limited.length,
    succeeded: results.filter((r) => r.status === "succeeded").length,
    failed: results.filter((r) => r.status === "failed").length,
    abortReason,
    interrupted: interrupted || undefined,
    results,
  };

  await mkdir(dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, JSON.stringify(report, null, 2), "utf-8");

  const totalMs = Date.now() - t0;
  console.log("\n=== Batch Summary ===");
  console.log(`  processed     : ${results.length}/${limited.length}`);
  console.log(`  succeeded     : ${report.succeeded}`);
  console.log(`  failed        : ${report.failed}`);
  console.log(`  elapsed       : ${formatDuration(totalMs)}`);
  if (abortReason) {
    console.log(`  abort reason  : ${abortReason}`);
  }
  console.log(`  report saved  : ${args.reportPath}`);

  if (report.failed > 0) {
    console.log(`\n[batch] ${report.failed} failures recorded in ${args.reportPath}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[batch] FATAL:", err);
  process.exit(2);
});
