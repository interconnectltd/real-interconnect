/**
 * predictions/baseline-tldv-asr.yaml と predictions/v2-ideal.yaml を
 * ground-truth から自動生成し直す。
 *
 *   baseline-tldv-asr: tl;dv の生 ASR 出力 (= correction の asr_speaker 値)
 *   v2-ideal:         V2 Layer 2++ が完璧に動いた場合 (= correction の true_speaker)
 *
 * "mixed" 行や confidence: low の補正は eval から除外されるが、 念のため記録。
 */
import fs from "node:fs";
import { parse, stringify } from "yaml";

const ROOT = "/Users/sara/realinterconnect/tests/eval/profile-extraction";
const gt = parse(fs.readFileSync(`${ROOT}/ground-truth/meeting-001.yaml`, "utf-8"));

const asrSpeakerToId = (asr) => {
  if (asr === "sara") return "P1";
  if (asr === "田口 恭平" || asr === "田口") return "P2";
  return "P_UNKNOWN";
};

// ─── baseline-tldv-asr ───
const baseline = {
  meeting_id: gt.meeting_id,
  pipeline_version: "baseline-tldv-asr",
  description: "tl;dv 生 ASR ラベルを盲信した場合。 V2 Layer 2++ 適用前。",
  speaker_assignments: gt.speaker_corrections.map((c) => ({
    timestamp: c.timestamp,
    speaker: asrSpeakerToId(c.asr_speaker),
  })),
  claims: [
    // tl;dv 要約 hallucination の代表例 (sara のシャンパンを 田口 に誤帰属)
    { speaker: "P2", field: "business.sideline", value: "シャンパンタワー / シャンパンコール", source_timestamp: "26:29" },
    // tl;dv が正しく抽出した一部
    { speaker: "P2", field: "career.history", value: "ホスト (前職)", source_timestamp: "26:12" },
    { speaker: "P1", field: "business.product", value: "経営者マッチングコミュニティ (AI ベース)", source_timestamp: "00:32" },
    // 田口 の事業情報 (Q1 の自己紹介で得られた最低限)
    { speaker: "P2", field: "business.industry_main", value: "営業代行", source_timestamp: "07:37" },
  ],
};
fs.writeFileSync(`${ROOT}/predictions/baseline-tldv-asr.yaml`, stringify(baseline, { lineWidth: 0 }));

// ─── v2-ideal ───
const ideal = {
  meeting_id: gt.meeting_id,
  pipeline_version: "v2-ideal",
  description: "V2 Layer 2++ が完璧に動作した場合の目標値。 すべての correction を正しく解決。",
  speaker_assignments: gt.speaker_corrections
    .filter((c) => c.true_speaker !== "mixed")
    .map((c) => ({ timestamp: c.timestamp, speaker: c.true_speaker })),
  claims: gt.expected_claims
    .filter((c) => c.confidence === "confirmed" || c.confidence === "high")
    .map((c) => ({
      speaker: c.speaker,
      field: c.field,
      value: c.value,
      source_timestamp: c.source_timestamp,
    })),
};
fs.writeFileSync(`${ROOT}/predictions/v2-ideal.yaml`, stringify(ideal, { lineWidth: 0 }));

console.log("baseline-tldv-asr: assignments=", baseline.speaker_assignments.length, "claims=", baseline.claims.length);
console.log("v2-ideal:          assignments=", ideal.speaker_assignments.length, "claims=", ideal.claims.length);
