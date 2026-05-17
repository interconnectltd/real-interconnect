/**
 * Merge agent proposals into ground-truth/meeting-001.yaml.
 *
 * Strategy:
 *   - 既存 sara 注釈は全 entry を `annotator: sara` で残す (覆さない)
 *   - 各 agent の entry は `annotator: agent-N` を付ける
 *   - timestamp 同一 + true_speaker 同一の場合は merge (annotator を [sara, agent-N] にする)
 *   - timestamp 同一 + true_speaker 不一致の場合は両方残す (conflict として note 付与)
 */
import fs from "node:fs";
import { parse, stringify } from "yaml";

const ROOT = "/Users/sara/realinterconnect/tests/eval/profile-extraction";

const gt = parse(fs.readFileSync(`${ROOT}/ground-truth/meeting-001.yaml`, "utf-8"));

// 既存 entry に annotator: sara を付ける
for (const c of gt.speaker_corrections) c.annotator = c.annotator ?? "sara";
for (const c of gt.expected_claims) c.annotator = c.annotator ?? "sara";
for (const c of gt.forbidden_claims) c.annotator = c.annotator ?? "sara";
for (const c of gt.ambiguous_zones || []) c.annotator = c.annotator ?? "sara";

let claimCounter = gt.expected_claims.length;
let forbiddenCounter = gt.forbidden_claims.length;

for (const agentId of ["agent-1", "agent-2", "agent-3", "agent-4"]) {
  const prop = parse(fs.readFileSync(`${ROOT}/proposals/${agentId}-corrections.yaml`, "utf-8"));

  for (const c of prop.speaker_corrections || []) {
    c.annotator = agentId;
    // existing と timestamp 同一かチェック
    const existing = gt.speaker_corrections.find((x) => x.timestamp === c.timestamp);
    if (existing) {
      // 同一 true_speaker なら merge (annotator を array に)
      if (existing.true_speaker === c.true_speaker) {
        existing.annotator = Array.isArray(existing.annotator)
          ? [...existing.annotator, agentId]
          : [existing.annotator, agentId];
      } else {
        // conflict: 両方残す + 注釈
        c.conflict_with = `existing entry by ${existing.annotator} disagrees (true_speaker=${existing.true_speaker})`;
        gt.speaker_corrections.push(c);
      }
    } else {
      gt.speaker_corrections.push(c);
    }
  }

  for (const c of prop.expected_claims || []) {
    c.annotator = agentId;
    c.id = `claim_${String(++claimCounter).padStart(3, "0")}`;
    // 同一 (speaker, field, value) があれば skip
    const dup = gt.expected_claims.find(
      (x) =>
        x.speaker === c.speaker &&
        x.field === c.field &&
        String(x.value).replace(/\s+/g, "") === String(c.value).replace(/\s+/g, "")
    );
    if (!dup) gt.expected_claims.push(c);
  }

  for (const c of prop.forbidden_claims || []) {
    c.annotator = agentId;
    c.id = `forbidden_${String(++forbiddenCounter).padStart(3, "0")}`;
    const dup = gt.forbidden_claims.find(
      (x) =>
        x.speaker_attributed_wrongly === c.speaker_attributed_wrongly &&
        x.field === c.field &&
        String(x.value).replace(/\s+/g, "") === String(c.value).replace(/\s+/g, "")
    );
    if (!dup) gt.forbidden_claims.push(c);
  }

  for (const c of prop.ambiguous_zones || []) {
    c.annotator = agentId;
    gt.ambiguous_zones = gt.ambiguous_zones || [];
    gt.ambiguous_zones.push(c);
  }
}

// annotation_complete を更新
gt.annotation_complete = false;  // sara review 必要
gt.annotation_stats = {
  total_corrections: gt.speaker_corrections.length,
  corrections_by_confidence: gt.speaker_corrections.reduce((acc, c) => {
    acc[c.confidence] = (acc[c.confidence] || 0) + 1;
    return acc;
  }, {}),
  total_claims: gt.expected_claims.length,
  total_forbidden: gt.forbidden_claims.length,
  total_ambiguous_zones: gt.ambiguous_zones?.length || 0,
  annotators: ["sara", "agent-1", "agent-2", "agent-3", "agent-4"],
  last_merge: new Date().toISOString().slice(0, 10),
};

// annotation_gap を update
gt.annotation_gap = {
  description: `Agent 1-4 が合計 ${gt.speaker_corrections.length - 4} の追加 correction を提案。 sara review 待ち。`,
  estimated_remaining_corrections: "sara 監修で 50-70% に絞り込み予定",
  conflicts_detected: gt.speaker_corrections.filter((c) => c.conflict_with).length,
};

fs.writeFileSync(`${ROOT}/ground-truth/meeting-001.yaml`, stringify(gt, { lineWidth: 0 }));
console.log("merged.");
console.log("corrections:", gt.speaker_corrections.length);
console.log("claims:", gt.expected_claims.length);
console.log("forbidden:", gt.forbidden_claims.length);
console.log("ambiguous:", gt.ambiguous_zones?.length || 0);
console.log("conflicts:", gt.annotation_gap.conflicts_detected);
