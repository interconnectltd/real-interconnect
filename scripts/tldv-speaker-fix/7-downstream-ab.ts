// 補正前 / 補正後 transcript を、本番と同じ Claude Opus 4.6 + 同じプロンプトに
// 投げて、抽出データ (needs / offers / key_statements) の差分を測る。
//
// Usage:
//   npx tsx scripts/tldv-speaker-fix/7-downstream-ab.ts \
//     --transcript scripts/tldv-speaker-fix/samples/transcript.txt \
//     --report     scripts/tldv-speaker-fix/output/3way-report.json \
//     --out        scripts/tldv-speaker-fix/output/downstream-ab.json
//
// 出力:
//   - JSON: 各発言者 × (A/B) の Opus 出力フル + diff サマリ
//   - コンソール: 重要フィールド差分を表で表示し、GO / STOP 判定

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// analyze.ts と同じプロンプト
const PROMPT_V3 = `あなたはビジネスミーティングの構造化分析エキスパートです。
指定された発言者について分析結果をJSONのみで出力してください。簡潔に。

【出力フィールド】
1. needs[] — text, explicit(bool), confidence(0-1), evidence[](max2), signals[], solver_profile(50-150字), urgency_signals[], category, subcategory
   solver_profile: このニーズに応えられる人はどういう人か
2. offers[] — text, explicit(bool), confidence(0-1), evidence[](max2), signals[], beneficiary_profile(50-150字), credibility("実績"|"自己申告"|"推論"), category, subcategory
   beneficiary_profile: このオファーが役立つ人はどういう人か
3. conversation_dynamics — rapport(0-1), information_asymmetry(0-1), unspoken_tensions[], follow_up_potential(bool)
4. topic_depth[] — topic, category, depth(0-1)
5. engagement_behaviors — asks_clarifying_questions, references_own_experience, shows_active_listening, contributes_solutions, expresses_interest_follow_up (全bool)
6. evidence_quotes[] — field, index, quote (max3件)
7. key_statements[] — max3件

【ルール】
- explicit:true→conf0.9+ / false→conf0.5-0.8
- credibility: 実績=具体数字あり / 自己申告=本人のみ / 推論=文脈から
- 日本語婉曲: 「ちょっと気になって」=重要課題 / 「もしよかったら」=明確ニーズ / 「まあ一応」=謙遜=実績 / 「いいですよね」=社交辞令(conf0.4以下)
- カテゴリ: sales,marketing,technology,finance,hr,legal,operations,strategy,design,industry,leadership,other

JSONのみ出力。説明不要。`;

interface Args {
  transcript: string;
  report: string;
  out: string;
  model: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const transcript = get("--transcript");
  const report = get("--report");
  const out = get("--out");
  if (!transcript || !report || !out) {
    console.error("Usage: --transcript <txt> --report <json> --out <json> [--model <id>]");
    process.exit(1);
  }
  return {
    transcript: resolve(transcript),
    report: resolve(report),
    out: resolve(out),
    model: get("--model") ?? "claude-opus-4-6",
  };
}

interface TranscriptSegment {
  speaker: string;   // 田島康平 / connect inter (生ラベル)
  startSec: number;
  text: string;
}

function parseTranscript(raw: string): TranscriptSegment[] {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const segs: TranscriptSegment[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\s+\[(\d{1,2}):(\d{2})\]:\s*(.*)$/);
    if (!m) continue;
    segs.push({
      speaker: m[1].trim(),
      startSec: parseInt(m[2], 10) * 60 + parseInt(m[3], 10),
      text: m[4].trim(),
    });
  }
  return segs;
}

interface ReportRow {
  idx: number;
  tldv: "tajima" | "sara" | "unknown";
  trueSpeaker: "tajima" | "sara" | "ambiguous" | "unknown";
  verdict: "all-agree" | "tldv-wrong" | "video-wrong" | "audio-wrong" | "all-disagree" | "with-unknown";
}

// 3-way verdict から、各セグメントの "補正後ラベル" を決める
//
// - all-agree:    3者一致 → tldv そのまま
// - tldv-wrong:   tldv 以外2者一致 → trueSpeaker で補正
// - video-wrong:  video だけ違う → tldv そのまま (= trueSpeaker は tldv と同じ)
// - audio-wrong:  audio だけ違う → tldv そのまま
// - with-unknown: 既知2者が一致なら trueSpeaker、それ以外は tldv 維持 (安全側)
// - all-disagree: 判定保留 → tldv 維持
function decideCorrectedLabel(
  tldvLabel: string,
  row: ReportRow | undefined,
  idToName: Record<string, string>,
): string {
  if (!row) return tldvLabel;
  if (row.verdict === "tldv-wrong" && (row.trueSpeaker === "tajima" || row.trueSpeaker === "sara")) {
    return idToName[row.trueSpeaker] ?? tldvLabel;
  }
  return tldvLabel;
}

function buildFullText(segments: TranscriptSegment[], labels: string[]): string {
  return segments.map((s, i) => `[${labels[i]}]: ${s.text}`).join("\n");
}

interface CallResult {
  raw: string;
  parsed: Record<string, unknown> | null;
  parseError?: string;
  durationMs: number;
  inputChars: number;
}

async function callOpus(
  client: Anthropic,
  model: string,
  fullText: string,
  speakerName: string,
): Promise<CallResult> {
  const userContent = `${PROMPT_V3}\n\n## 発言者: ${speakerName}\n\n## トランスクリプト:\n${fullText.slice(0, 30000)}`;
  const t0 = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0, // A/B の純粋な diff を見るため
    messages: [{ role: "user", content: userContent }],
  });
  const durationMs = Date.now() - t0;

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { raw: text, parsed: null, parseError: "no JSON block found", durationMs, inputChars: userContent.length };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return { raw: text, parsed, durationMs, inputChars: userContent.length };
  } catch (e) {
    return {
      raw: text,
      parsed: null,
      parseError: e instanceof Error ? e.message : String(e),
      durationMs,
      inputChars: userContent.length,
    };
  }
}

// diff サマリ: text フィールドの集合比較で「実質的な変化」をカウント
interface DiffSummary {
  needs: { aCount: number; bCount: number; aOnly: string[]; bOnly: string[]; common: number };
  offers: { aCount: number; bCount: number; aOnly: string[]; bOnly: string[]; common: number };
  keyStatements: { aCount: number; bCount: number; aOnly: string[]; bOnly: string[]; common: number };
}

function extractTexts(obj: Record<string, unknown> | null, key: string): string[] {
  if (!obj || !Array.isArray(obj[key])) return [];
  return (obj[key] as Array<Record<string, unknown> | string>)
    .map((x) => typeof x === "string" ? x : (typeof x.text === "string" ? x.text : ""))
    .filter(Boolean);
}

// 簡易類似度: 共通の意味あるトークンが半分以上一致したら "同じエントリ" とみなす
function similar(a: string, b: string): boolean {
  const tokenize = (s: string) => new Set(s.replace(/[、。「」（）()\s]/g, "").split("").filter((c) => /\S/.test(c)));
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const smaller = Math.min(ta.size, tb.size);
  return common / smaller >= 0.5;
}

function diffStringSets(a: string[], b: string[]) {
  const aOnly: string[] = [];
  const bOnly: string[] = [];
  let common = 0;
  for (const x of a) {
    if (b.some((y) => similar(x, y))) common++;
    else aOnly.push(x);
  }
  for (const y of b) {
    if (!a.some((x) => similar(x, y))) bOnly.push(y);
  }
  return { aCount: a.length, bCount: b.length, aOnly, bOnly, common };
}

function makeDiff(a: Record<string, unknown> | null, b: Record<string, unknown> | null): DiffSummary {
  return {
    needs:         diffStringSets(extractTexts(a, "needs"),          extractTexts(b, "needs")),
    offers:        diffStringSets(extractTexts(a, "offers"),         extractTexts(b, "offers")),
    keyStatements: diffStringSets(extractTexts(a, "key_statements"), extractTexts(b, "key_statements")),
  };
}

function fmtDiff(label: string, d: DiffSummary["needs"]): string {
  const lines: string[] = [];
  lines.push(`  ${label}: A=${d.aCount} B=${d.bCount} (common=${d.common})`);
  if (d.aOnly.length) {
    lines.push(`    [A のみ — 補正で消えた]`);
    for (const t of d.aOnly) lines.push(`      - ${t.slice(0, 80)}`);
  }
  if (d.bOnly.length) {
    lines.push(`    [B のみ — 補正で出現]`);
    for (const t of d.bOnly) lines.push(`      + ${t.slice(0, 80)}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY not set in .env.local");

  const [transcriptRaw, reportRaw] = await Promise.all([
    readFile(args.transcript, "utf-8"),
    readFile(args.report, "utf-8"),
  ]);
  const segments = parseTranscript(transcriptRaw);
  const report = JSON.parse(reportRaw) as { rows: ReportRow[] };
  const rowsByIdx = new Map(report.rows.map((r) => [r.idx, r]));

  // 正規化 ID → 生ラベルの対応 (この録画の参加者)
  const idToName: Record<string, string> = {
    tajima: "田島康平",
    sara: "connect inter",
  };
  const participants = [
    { id: "tajima", displayName: "田島康平" },
    { id: "sara",   displayName: "connect inter" },
  ];

  // A: tldv 生ラベル
  const labelsA = segments.map((s) => s.speaker);
  // B: 3-way 補正後ラベル
  const labelsB = segments.map((s, i) => decideCorrectedLabel(s.speaker, rowsByIdx.get(i), idToName));

  // 何件のラベルが変わったかを確認
  const labelChanges = labelsA.reduce((acc, a, i) => acc + (a === labelsB[i] ? 0 : 1), 0);

  const fullTextA = buildFullText(segments, labelsA);
  const fullTextB = buildFullText(segments, labelsB);

  console.log("[setup]", {
    segments: segments.length,
    labelChanges,
    fullTextLenA: fullTextA.length,
    fullTextLenB: fullTextB.length,
    model: args.model,
  });

  if (labelChanges === 0) {
    console.error("ERROR: 補正後ラベルが生ラベルと完全一致。3-way report の verdict 列を確認してください。");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  // 4 コール: 田島(A), 田島(B), sara(A), sara(B)
  console.log("\n[calling Opus 4.6]");
  const calls = await Promise.all(
    participants.flatMap((p) => [
      callOpus(client, args.model, fullTextA, p.displayName).then((r) => ({ ...p, condition: "A" as const, result: r })),
      callOpus(client, args.model, fullTextB, p.displayName).then((r) => ({ ...p, condition: "B" as const, result: r })),
    ])
  );
  for (const c of calls) {
    console.log(`  ${c.displayName.padEnd(15)} ${c.condition}  ${c.result.durationMs}ms  parsed=${c.result.parsed ? "OK" : "FAIL"}  inputChars=${c.result.inputChars}`);
  }

  // diff
  console.log("\n" + "=".repeat(80));
  console.log("DOWNSTREAM A/B RESULT");
  console.log("=".repeat(80));

  const perParticipant: Array<{ id: string; name: string; diff: DiffSummary; a: Record<string, unknown> | null; b: Record<string, unknown> | null }> = [];

  for (const p of participants) {
    const a = calls.find((c) => c.id === p.id && c.condition === "A")!.result.parsed;
    const b = calls.find((c) => c.id === p.id && c.condition === "B")!.result.parsed;
    const diff = makeDiff(a, b);
    perParticipant.push({ id: p.id, name: p.displayName, diff, a, b });

    console.log(`\n--- ${p.displayName} (${p.id}) ---`);
    console.log(fmtDiff("needs         ", diff.needs));
    console.log(fmtDiff("offers        ", diff.offers));
    console.log(fmtDiff("key_statements", diff.keyStatements));
  }

  // 重要度判定: needs/offers/key_statements で「片側だけに存在」したエントリの合計
  const importantChanges = perParticipant.reduce((sum, p) => sum +
    p.diff.needs.aOnly.length + p.diff.needs.bOnly.length +
    p.diff.offers.aOnly.length + p.diff.offers.bOnly.length +
    p.diff.keyStatements.aOnly.length + p.diff.keyStatements.bOnly.length, 0);

  console.log("\n" + "=".repeat(80));
  console.log(`Total important changes: ${importantChanges}`);
  console.log(`Decision: ${importantChanges >= 2 ? "✅ GO (補正は下流に効いている → Phase 1 へ)" : "❌ STOP (差が小さい → 設計見直し)"}`);
  console.log("=".repeat(80));

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: args.model,
    setup: { segments: segments.length, labelChanges },
    perParticipant,
    importantChanges,
    decision: importantChanges >= 2 ? "GO" : "STOP",
    rawCalls: calls.map((c) => ({
      id: c.id, name: c.displayName, condition: c.condition,
      durationMs: c.result.durationMs,
      inputChars: c.result.inputChars,
      parseError: c.result.parseError,
      raw: c.result.raw,
    })),
  }, null, 2), "utf-8");
  console.log(`\n→ saved: ${args.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
