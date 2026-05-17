/**
 * profile-extraction-runner
 * ─────────────────────────────────────────────────────────────
 * V2 architecture の評価基盤 (Phase 0 skeleton)。
 * ground-truth YAML と pipeline 出力 (predictions YAML) を読み込み、
 * 4 metric を計算する:
 *   M1 speaker_attribution_accuracy
 *   M2 claim_precision
 *   M3 claim_recall
 *   M4 hallucination_rate
 *
 * 実行:
 *   pnpm tsx scripts/eval/profile-extraction-runner.ts \
 *     --ground-truth tests/eval/profile-extraction/ground-truth/meeting-001.yaml \
 *     --predictions  tests/eval/profile-extraction/results/baseline-v0.yaml
 *
 * predictions YAML の形は ground-truth と相同 (speaker_corrections は省略可)。
 * baseline 不在時は "asr" (tl;dv 生 ASR ラベル) を baseline として使う。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { parse as parseYaml } from "yaml";

// ─────────────────────────────────────────────────────────
// Types — ground-truth YAML schema を反映
// ─────────────────────────────────────────────────────────
type ParticipantId = string;

type SpeakerCorrection = {
  timestamp: string;
  asr_speaker: string;
  true_speaker: ParticipantId;
  utterance_excerpt: string;
  failure_category: string;
  confidence: "high" | "medium" | "low";
};

type ExpectedClaim = {
  id: string;
  speaker: ParticipantId;
  field: string;
  value: string | number | boolean;
  source_timestamp?: string;
  confidence: "confirmed" | "high" | "medium" | "low";
};

type ForbiddenClaim = {
  id: string;
  speaker_attributed_wrongly: ParticipantId;
  true_speaker: ParticipantId;
  field: string;
  value: string;
  failure_category: string;
  severity: "critical" | "high" | "medium" | "low";
};

type GroundTruth = {
  meeting_id: string;
  participants: { id: ParticipantId; display_name: string; aliases?: string[] }[];
  speaker_corrections: SpeakerCorrection[];
  ambiguous_zones?: { timestamp_range: [string, string]; reason: string }[];
  expected_claims: ExpectedClaim[];
  forbidden_claims: ForbiddenClaim[];
};

type PredictionClaim = {
  speaker: ParticipantId;
  field: string;
  value: string | number | boolean;
  source_timestamp?: string;
};

type Predictions = {
  meeting_id: string;
  pipeline_version: string;
  speaker_assignments: { timestamp: string; speaker: ParticipantId }[];
  claims: PredictionClaim[];
};

// ─────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k && k.startsWith("--") && v !== undefined) {
      args[k.slice(2)] = v;
      i++;
    }
  }
  return args;
}

// ─────────────────────────────────────────────────────────
// Metric calculations
// ─────────────────────────────────────────────────────────
function isInAmbiguousZone(ts: string, gt: GroundTruth): boolean {
  if (!gt.ambiguous_zones) return false;
  return gt.ambiguous_zones.some(
    (z) => tsToSeconds(ts) >= tsToSeconds(z.timestamp_range[0]) && tsToSeconds(ts) <= tsToSeconds(z.timestamp_range[1])
  );
}

function tsToSeconds(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

/**
 * M1 — speaker attribution accuracy
 * ground-truth.speaker_corrections に挙がる「真の話者」と
 * predictions.speaker_assignments を比較。
 * ambiguous_zones の発話はカウント外。
 */
function calcSpeakerAccuracy(gt: GroundTruth, pred: Predictions) {
  let total = 0;
  let correct = 0;
  const misses: Array<{ ts: string; expected: ParticipantId; got: ParticipantId | undefined }> = [];

  for (const correction of gt.speaker_corrections) {
    // confidence: low の訂正は eval から除外 (annotator も自信が無い)。
    if (correction.confidence === "low") continue;
    // true_speaker が "mixed" の発話は M1 では測れない (1 行を分割する別 metric が必要)。
    if (correction.true_speaker === "mixed") continue;
    total++;
    const got = pred.speaker_assignments.find((s) => s.timestamp === correction.timestamp)?.speaker;
    if (got === correction.true_speaker) {
      correct++;
    } else {
      misses.push({ ts: correction.timestamp, expected: correction.true_speaker, got });
    }
  }
  return {
    metric: "speaker_attribution_accuracy",
    score: total === 0 ? null : correct / total,
    total,
    correct,
    misses,
  };
}

/**
 * 値が一致しているか (緩く正規化)
 */
function valueMatches(a: unknown, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === "string" && typeof b === "string") {
    return a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
  }
  return a === b;
}

/**
 * M2 — claim precision
 * 抽出 claim のうち、 expected_claims に一致するもの / 抽出全数
 */
function calcClaimPrecision(gt: GroundTruth, pred: Predictions) {
  let truePos = 0;
  const falsePositives: PredictionClaim[] = [];
  for (const p of pred.claims) {
    const match = gt.expected_claims.find(
      (e) => e.speaker === p.speaker && e.field === p.field && valueMatches(e.value, p.value)
    );
    if (match) {
      truePos++;
    } else {
      falsePositives.push(p);
    }
  }
  return {
    metric: "claim_precision",
    score: pred.claims.length === 0 ? null : truePos / pred.claims.length,
    truePos,
    totalExtracted: pred.claims.length,
    falsePositives,
  };
}

/**
 * M3 — claim recall
 * expected_claims のうち、 抽出された数 / 全 expected 数 (confirmed のみ)
 */
function calcClaimRecall(gt: GroundTruth, pred: Predictions) {
  const targets = gt.expected_claims.filter((e) => e.confidence === "confirmed");
  let hit = 0;
  const misses: ExpectedClaim[] = [];
  for (const e of targets) {
    const found = pred.claims.some(
      (p) => p.speaker === e.speaker && p.field === e.field && valueMatches(p.value, e.value)
    );
    if (found) hit++;
    else misses.push(e);
  }
  return {
    metric: "claim_recall",
    score: targets.length === 0 ? null : hit / targets.length,
    hit,
    totalConfirmed: targets.length,
    misses,
  };
}

/**
 * M4 — hallucination rate
 * forbidden_claims のうち、 (誤帰属で) 抽出されたものの割合。
 * critical 1 件でも出たら fail とする gating も推奨。
 */
function calcHallucinationRate(gt: GroundTruth, pred: Predictions) {
  let hits = 0;
  const detected: ForbiddenClaim[] = [];
  for (const f of gt.forbidden_claims) {
    const matched = pred.claims.some(
      (p) => p.speaker === f.speaker_attributed_wrongly && p.field === f.field && valueMatches(p.value, f.value)
    );
    if (matched) {
      hits++;
      detected.push(f);
    }
  }
  return {
    metric: "hallucination_rate",
    score: pred.claims.length === 0 ? 0 : hits / pred.claims.length,
    hits,
    totalForbidden: gt.forbidden_claims.length,
    detected,
    gating_critical_violation: detected.some((d) => d.severity === "critical"),
  };
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
function main() {
  const args = parseArgs();
  const gtPath = args["ground-truth"];
  const predPath = args["predictions"];
  if (!gtPath) {
    console.error("usage: --ground-truth <file.yaml> [--predictions <file.yaml>] [--out <results.json>]");
    process.exit(2);
  }
  const gt = parseYaml(readFileSync(resolve(gtPath), "utf-8")) as GroundTruth;

  let pred: Predictions;
  if (predPath && existsSync(resolve(predPath))) {
    pred = parseYaml(readFileSync(resolve(predPath), "utf-8")) as Predictions;
  } else {
    // baseline: 空の予測 (pipeline 未接続)。 すべて 0 / null になる。
    pred = {
      meeting_id: gt.meeting_id,
      pipeline_version: "empty-baseline",
      speaker_assignments: [],
      claims: [],
    };
    console.warn("[runner] no --predictions given, using empty baseline (all metrics = 0/null)");
  }

  const results = {
    meeting_id: gt.meeting_id,
    pipeline_version: pred.pipeline_version,
    timestamp: new Date().toISOString(),
    metrics: {
      M1: calcSpeakerAccuracy(gt, pred),
      M2: calcClaimPrecision(gt, pred),
      M3: calcClaimRecall(gt, pred),
      M4: calcHallucinationRate(gt, pred),
    },
  };

  const outPath = args["out"] ?? `tests/eval/profile-extraction/results/${pred.pipeline_version}_${gt.meeting_id}.json`;
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify(results, null, 2));

  console.log("─".repeat(72));
  console.log(`meeting: ${gt.meeting_id}   pipeline: ${pred.pipeline_version}`);
  console.log("─".repeat(72));
  console.log(`M1 speaker_attribution_accuracy : ${fmt(results.metrics.M1.score)}  (${results.metrics.M1.correct}/${results.metrics.M1.total})`);
  console.log(`M2 claim_precision              : ${fmt(results.metrics.M2.score)}  (${results.metrics.M2.truePos}/${results.metrics.M2.totalExtracted})`);
  console.log(`M3 claim_recall                 : ${fmt(results.metrics.M3.score)}  (${results.metrics.M3.hit}/${results.metrics.M3.totalConfirmed})`);
  console.log(`M4 hallucination_rate           : ${fmt(results.metrics.M4.score)}  (${results.metrics.M4.hits} fired)`);
  if (results.metrics.M4.gating_critical_violation) {
    console.error("🚨 CRITICAL hallucination detected — gating violation");
  }
  console.log(`\nwrote: ${outPath}`);
}

function fmt(n: number | null): string {
  return n === null ? "n/a" : (n * 100).toFixed(1) + "%";
}

main();
