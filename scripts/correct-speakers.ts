// 3-way speaker correction CLI v2
//
// 動画 mp4 から、tldv の話者ラベル誤判定を 3-way 多数決で補正した transcript を
// JSON で出力する。 DB 書き込みはまだ実装しない (= 安全に試せる)。
//
// === 使い方 (v2 自動モード, 推奨) ===
//
//   pnpm correct-speakers -- \
//     --video ~/Downloads/田島-2026-05-10.mp4
//
//   ファイル名から日付 + 名前を抽出 → Supabase で meeting を特定 →
//   tldv API から transcript 取得 → 参加者から speaker map 自動構築。
//
// === 使い方 (v1 手動モード, 後方互換) ===
//
//   pnpm correct-speakers -- \
//     --video <path> --transcript <path> --ref-dir <dir> \
//     --left "田島康平" --left-id tajima \
//     --right "connect inter" --right-id sara \
//     --out <path>
//
// === 引数 ===
//
//   --video         mp4 ファイルパス (必須)
//   --meeting-id    DB lookup 結果を override (任意、UUID)
//   --transcript    transcript テキストを直指定 (任意、指定時は DB lookup スキップ = v1 モード)
//   --ref-dir       参照声 mp3 dir (default: scripts/tldv-speaker-fix/audio/refs)
//   --left          左タイル speaker 生名 (任意、auto-derive)
//   --right         右タイル speaker 生名 (任意、auto-derive)
//   --left-id       左タイル正規化 ID (任意、auto-derive)
//   --right-id      右タイル正規化 ID (任意、auto-derive)
//   --out           出力 JSON パス (default: <video-basename>.corrected.json)
//   --limit-seconds 動画の最初の N 秒だけ処理 (任意)
//   --skip-frames   既存フレーム再利用 (任意)
//   --work-dir      中間ファイル dir (default: ./scripts/tldv-speaker-fix/e2e-work)
//   --non-interactive  複数候補時にエラー (default は TTY で選択)
//   --auto-pick-first  複数候補時に最初を採用

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  buildFullText,
  correctSpeakers,
  fromTldvSegments,
  parseTranscriptText,
  type CorrectSpeakersOutput,
  type ReferenceVoice,
  type Segment,
} from "../src/lib/speaker-correction";
import { createTldvClient } from "../src/lib/tldv/client";

// ──────────────────────────────────────────────────────────────────
// CLI 引数パース
// ──────────────────────────────────────────────────────────────────

interface CliArgs {
  video: string;
  meetingId?: string;
  transcriptPath?: string;
  refDir: string;
  leftName?: string;
  rightName?: string;
  leftId?: string;
  rightId?: string;
  out: string;
  workDir: string;
  limitSeconds?: number;
  skipFrames: boolean;
  nonInteractive: boolean;
  autoPickFirst: boolean;
  noAutoRefs: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const video = get("--video");
  if (!video) {
    console.error(
      "Usage:\n" +
        "  v2 (auto): pnpm correct-speakers -- --video <path>\n" +
        "  v1 (manual): pnpm correct-speakers -- --video <path> --transcript <path> \\\n" +
        "                 --ref-dir <dir> --left <name> --left-id <id> --right <name> --right-id <id> --out <path>\n",
    );
    process.exit(1);
  }
  const videoResolved = resolve(video);
  return {
    video: videoResolved,
    meetingId: get("--meeting-id"),
    transcriptPath: get("--transcript") ? resolve(get("--transcript") as string) : undefined,
    refDir: resolve(get("--ref-dir") ?? "./scripts/tldv-speaker-fix/audio/refs"),
    leftName: get("--left"),
    rightName: get("--right"),
    leftId: get("--left-id"),
    rightId: get("--right-id"),
    out: resolve(get("--out") ?? videoResolved.replace(/\.[mM][pP]4$/, "") + ".corrected.json"),
    workDir: resolve(get("--work-dir") ?? "./scripts/tldv-speaker-fix/e2e-work"),
    limitSeconds: get("--limit-seconds") ? Number(get("--limit-seconds")) : undefined,
    skipFrames: has("--skip-frames"),
    nonInteractive: has("--non-interactive"),
    autoPickFirst: has("--auto-pick-first"),
    noAutoRefs: has("--no-auto-refs"),
  };
}

// ──────────────────────────────────────────────────────────────────
// エラーバイル
// ──────────────────────────────────────────────────────────────────

function bail(message: string, hint?: string, exitCode: 1 | 2 = 1): never {
  console.error(`[correct-speakers] ERROR: ${message}`);
  if (hint) console.error(`  hint: ${hint}`);
  process.exit(exitCode);
}

// ──────────────────────────────────────────────────────────────────
// filename パース
// ──────────────────────────────────────────────────────────────────

interface FilenameParts {
  name: string;
  date: string; // YYYY-MM-DD
}

function parseFilename(videoPath: string): FilenameParts | null {
  const fn = basename(videoPath);
  // 基本形: <名前>[-_]<YYYY-MM-DD>.mp4
  const m = fn.match(/^(.+?)[-_](\d{4}-\d{1,2}-\d{1,2})\.[mM][pP]4$/);
  if (!m) return null;
  const name = (m[1] ?? "").trim();
  const rawDate = m[2] ?? "";
  // 0 埋め正規化: 2026-5-10 → 2026-05-10
  const parts = rawDate.split("-");
  if (parts.length !== 3) return null;
  const date = `${parts[0]}-${(parts[1] ?? "").padStart(2, "0")}-${(parts[2] ?? "").padStart(2, "0")}`;
  return { name, date };
}

// ──────────────────────────────────────────────────────────────────
// Supabase クライアント
// ──────────────────────────────────────────────────────────────────

function createSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) {
    bail(
      "Supabase env not set",
      "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local",
      2,
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ──────────────────────────────────────────────────────────────────
// meeting 検索
// ──────────────────────────────────────────────────────────────────

interface ParticipantRow {
  id: string;
  transcript_id: string;
  speaker_name: string;
  speaking_ratio: number | null;
  user_id: string | null;
  is_linked: boolean;
}

interface MeetingRow {
  id: string;
  tldv_meeting_id: string;
  title: string | null;
  meeting_date: string | null;
  meeting_kind: string;
  status: string;
  participants: ParticipantRow[];
}

async function searchMeetings(
  supabase: ReturnType<typeof createSupabase>,
  name: string,
  date: string,
): Promise<MeetingRow[]> {
  // 日本時刻 YYYY-MM-DD → UTC range
  const jstStart = new Date(`${date}T00:00:00+09:00`).toISOString();
  const jstEnd = new Date(
    new Date(`${date}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000 - 1,
  ).toISOString();

  const { data: meetings, error } = await supabase
    .from("meeting_transcripts")
    .select("id, tldv_meeting_id, title, meeting_date, meeting_kind, status")
    .gte("meeting_date", jstStart)
    .lte("meeting_date", jstEnd)
    .not("meeting_kind", "in", "(internal,onboarding)")
    .in("status", ["ready", "analyzed"]);

  if (error) bail(`Supabase query failed: ${error.message}`, "Check connection / RLS", 2);
  if (!meetings || meetings.length === 0) return [];

  // participants を batch fetch
  const transcriptIds = meetings.map((m) => m.id);
  const { data: parts, error: pErr } = await supabase
    .from("meeting_participants")
    .select("id, transcript_id, speaker_name, speaking_ratio, user_id, is_linked")
    .in("transcript_id", transcriptIds);

  if (pErr) bail(`Supabase participants query failed: ${pErr.message}`, undefined, 2);

  const partsByTranscript = new Map<string, ParticipantRow[]>();
  for (const p of (parts as ParticipantRow[] | null) ?? []) {
    const existing = partsByTranscript.get(p.transcript_id) ?? [];
    existing.push(p);
    partsByTranscript.set(p.transcript_id, existing);
  }

  // 名前で絞り込み
  const candidates: MeetingRow[] = [];
  for (const m of meetings) {
    const ps = partsByTranscript.get(m.id) ?? [];
    const matchesName = ps.some((p) =>
      p.speaker_name.toLowerCase().includes(name.toLowerCase()),
    );
    if (matchesName) {
      candidates.push({ ...m, participants: ps });
    }
  }
  return candidates;
}

// ──────────────────────────────────────────────────────────────────
// 候補選択 (TTY interactive)
// ──────────────────────────────────────────────────────────────────

async function pickMeeting(
  candidates: MeetingRow[],
  args: CliArgs,
): Promise<MeetingRow> {
  if (candidates.length === 0) {
    bail(
      "No matching meeting found",
      "Check filename format (<name>-YYYY-MM-DD.mp4) or use --meeting-id <uuid>",
    );
  }
  if (candidates.length === 1) {
    return candidates[0] as MeetingRow;
  }
  if (args.autoPickFirst) {
    console.warn(`[correct-speakers] WARN: ${candidates.length} candidates found, picking the first`);
    return candidates[0] as MeetingRow;
  }
  if (args.nonInteractive || !input.isTTY) {
    bail(
      `${candidates.length} meetings match, cannot disambiguate in non-interactive mode`,
      "Use --meeting-id <uuid> to specify exactly which meeting, or --auto-pick-first",
    );
  }

  console.log(`\n複数の候補が見つかりました (${candidates.length} 件):`);
  candidates.forEach((m, i) => {
    const title = m.title ?? "(untitled)";
    const date = m.meeting_date ? new Date(m.meeting_date).toLocaleString("ja-JP") : "(no date)";
    const names = m.participants.map((p) => p.speaker_name).join(", ");
    console.log(`  [${i + 1}] ${title}  (${date})  参加者: ${names}`);
  });

  const rl = createInterface({ input, output });
  try {
    const ans = await rl.question(`\nどれを選びますか? (1-${candidates.length}): `);
    const idx = parseInt(ans.trim(), 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= candidates.length) {
      bail(`Invalid selection: "${ans.trim()}"`);
    }
    return candidates[idx] as MeetingRow;
  } finally {
    rl.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// speaker map auto-derive
// ──────────────────────────────────────────────────────────────────

interface SpeakerMapResolved {
  leftName: string;
  rightName: string;
  leftId: string;
  rightId: string;
  nameToId: Record<string, string>;
  idToName: Record<string, string>;
}

function makeSpeakerId(participant: ParticipantRow | undefined, index: 0 | 1): string {
  if (participant?.user_id) {
    const prefix = participant.user_id.split("-")[0]?.slice(0, 8) ?? "";
    if (prefix) return `user_${prefix}`;
  }
  return `speaker_${index}`;
}

function deriveSpeakerMap(
  segments: Segment[],
  participants: ParticipantRow[],
  override: { leftName?: string; rightName?: string; leftId?: string; rightId?: string },
): SpeakerMapResolved {
  const uniqueSpeakers = [...new Set(segments.map((s) => s.speaker))];
  if (uniqueSpeakers.length === 1) {
    bail(
      `transcript has only 1 unique speaker: ${uniqueSpeakers[0]}`,
      "モノローグは補正対象外 (誤判定が起きない)",
    );
  }
  if (uniqueSpeakers.length > 2) {
    bail(
      `${uniqueSpeakers.length} unique speakers detected (multi-party): ${uniqueSpeakers.join(", ")}`,
      "MVP は 2 人会議のみ対応",
    );
  }

  // 発話開始順 = 左タイル
  const firstSpeaker = uniqueSpeakers[0] as string;
  const otherSpeaker = uniqueSpeakers.find((s) => s !== firstSpeaker) as string;

  const leftName = override.leftName ?? firstSpeaker;
  const rightName = override.rightName ?? otherSpeaker;

  // participant 行を引く (transcript の speaker_name と完全一致で参照)
  const leftPart = participants.find((p) => p.speaker_name === leftName);
  const rightPart = participants.find((p) => p.speaker_name === rightName);

  const leftId = override.leftId ?? makeSpeakerId(leftPart, 0);
  const rightId = override.rightId ?? makeSpeakerId(rightPart, 1);

  return {
    leftName,
    rightName,
    leftId,
    rightId,
    nameToId: { [leftName]: leftId, [rightName]: rightId },
    idToName: { [leftId]: leftName, [rightId]: rightName },
  };
}

// ──────────────────────────────────────────────────────────────────
// reference voice 解決 (3 段階 fallback)
// ──────────────────────────────────────────────────────────────────

/**
 * 参照声ファイルを 3 段階 fallback で検索。
 * 見つからなければ null を返す (caller が自動抽出 or bail を判断)。
 */
function findReferenceVoicePath(
  refDir: string,
  id: string,
  name: string,
  userId: string | null,
): { path: string; tried: string[] } | { path: null; tried: string[] } {
  const candidates: string[] = [];
  if (userId) {
    const prefix = userId.split("-")[0]?.slice(0, 8) ?? "";
    if (prefix) candidates.push(resolve(refDir, `user_${prefix}.mp3`));
  }
  candidates.push(resolve(refDir, `${id}.mp3`));
  candidates.push(resolve(refDir, `${name}.mp3`));

  for (const p of candidates) {
    if (existsSync(p)) return { path: p, tried: candidates };
  }
  return { path: null, tried: candidates };
}

/**
 * 自動抽出した参照声をキャッシュとして ref-dir に保存。
 * 優先キー: user_<short-uuid> > <speaker-id>。 次回 CLI 実行時に findReferenceVoicePath が拾える形。
 */
async function saveExtractedRefToCache(
  refDir: string,
  speakerId: string,
  userId: string | null,
  audioBuffer: Buffer,
): Promise<string> {
  await mkdir(refDir, { recursive: true });
  let filename: string;
  if (userId) {
    const prefix = userId.split("-")[0]?.slice(0, 8) ?? "";
    if (prefix) filename = `user_${prefix}.mp3`;
    else filename = `${speakerId}.mp3`;
  } else {
    filename = `${speakerId}.mp3`;
  }
  const filepath = resolve(refDir, filename);
  await writeFile(filepath, audioBuffer);
  return filepath;
}

// ──────────────────────────────────────────────────────────────────
// 出力 JSON スキーマ
// ──────────────────────────────────────────────────────────────────

interface OutputCorrection {
  idx: number;
  time: string;
  originalLabel: string;
  newLabel: string;
  text: string;
}

// ──────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // 環境変数チェック
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    bail("GEMINI_API_KEY not set", "Add GEMINI_API_KEY=... to .env.local", 2);
  }

  // ファイル存在チェック
  if (!existsSync(args.video)) {
    bail(`video file not found: ${args.video}`, "Check the --video path");
  }
  // ref-dir は存在しなくても OK (自動抽出する場合は後で mkdir される)。 ただし
  // --no-auto-refs フラグ指定時は ref-dir が必要。
  if (args.noAutoRefs && !existsSync(args.refDir)) {
    bail(
      `reference voice dir not found: ${args.refDir} (--no-auto-refs set)`,
      "Provide --ref-dir or remove --no-auto-refs to allow auto-extraction",
    );
  }

  // モード判定: --transcript 指定なら v1 (手動)、そうでなければ v2 (auto)
  const isManualMode = !!args.transcriptPath;

  let segments: Segment[];
  let participants: ParticipantRow[] = [];
  let resolvedMeetingId: string | undefined;
  let tldvMeetingId: string | undefined;

  if (isManualMode) {
    console.log("[correct-speakers] mode: v1 (manual, --transcript specified)");
    if (!args.transcriptPath || !existsSync(args.transcriptPath)) {
      bail(`transcript file not found: ${args.transcriptPath}`);
    }
    const transcriptRaw = await readFile(args.transcriptPath, "utf-8");
    segments = parseTranscriptText(transcriptRaw);
    if (segments.length === 0) {
      bail("transcript is empty or unparseable");
    }
  } else {
    // v2 自動モード: filename → DB → tldv API
    console.log("[correct-speakers] mode: v2 (auto via Supabase + tldv API)");
    const supabase = createSupabase();

    let meeting: MeetingRow;

    if (args.meetingId) {
      // 明示指定された meeting_id を取得
      const { data, error } = await supabase
        .from("meeting_transcripts")
        .select("id, tldv_meeting_id, title, meeting_date, meeting_kind, status")
        .eq("id", args.meetingId)
        .maybeSingle();
      if (error) bail(`Supabase fetch failed: ${error.message}`, undefined, 2);
      if (!data) bail(`meeting_id not found: ${args.meetingId}`);
      const { data: parts, error: pErr } = await supabase
        .from("meeting_participants")
        .select("id, transcript_id, speaker_name, speaking_ratio, user_id, is_linked")
        .eq("transcript_id", data.id);
      if (pErr) bail(`Supabase participants fetch failed: ${pErr.message}`, undefined, 2);
      meeting = { ...data, participants: (parts as ParticipantRow[] | null) ?? [] };
    } else {
      // filename からパース
      const parts = parseFilename(args.video);
      if (!parts) {
        bail(
          `Cannot parse filename: ${basename(args.video)}`,
          "Use format <name>-YYYY-MM-DD.mp4 or specify --meeting-id <uuid>",
        );
      }
      console.log(`  parsed: name="${parts.name}" date=${parts.date}`);
      const candidates = await searchMeetings(supabase, parts.name, parts.date);
      meeting = await pickMeeting(candidates, args);
    }

    resolvedMeetingId = meeting.id;
    tldvMeetingId = meeting.tldv_meeting_id;
    participants = meeting.participants;

    if (!tldvMeetingId) {
      bail(
        `meeting ${meeting.id} has no tldv_meeting_id`,
        "Manual imports not supported in MVP; use --transcript path instead",
      );
    }

    console.log(`  meeting: ${meeting.title ?? "(untitled)"} (id=${meeting.id})`);
    console.log(`  participants: ${participants.map((p) => p.speaker_name).join(", ")}`);

    // tldv API から segments 取得 (startTime/endTime 付き)
    const tldv = createTldvClient();
    let transcriptRes;
    try {
      transcriptRes = await tldv.getTranscript(tldvMeetingId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bail(`tldv API getTranscript failed: ${msg}`, "Check TLDV_API_KEY or network", 2);
    }
    segments = fromTldvSegments(transcriptRes.data ?? []);
    if (segments.length === 0) {
      bail("tldv API returned 0 segments");
    }
  }

  // speaker map 構築
  const speakerMap = deriveSpeakerMap(segments, participants, {
    leftName: args.leftName,
    rightName: args.rightName,
    leftId: args.leftId,
    rightId: args.rightId,
  });

  // multi-party guard は deriveSpeakerMap 内で bail されてるので、ここまで来たら 2 人確定

  // 参照声ファイル解決 (見つからないものは null で進める → orchestrator が自動抽出)
  const leftPart = participants.find((p) => p.speaker_name === speakerMap.leftName);
  const rightPart = participants.find((p) => p.speaker_name === speakerMap.rightName);

  const refLeftResult = findReferenceVoicePath(
    args.refDir,
    speakerMap.leftId,
    speakerMap.leftName,
    leftPart?.user_id ?? null,
  );
  const refRightResult = findReferenceVoicePath(
    args.refDir,
    speakerMap.rightId,
    speakerMap.rightName,
    rightPart?.user_id ?? null,
  );

  // --no-auto-refs 指定時は不在で bail
  if (args.noAutoRefs) {
    if (!refLeftResult.path) {
      bail(
        `Reference voice not found for "${speakerMap.leftName}" (--no-auto-refs set)`,
        `Provide ONE:\n  ${refLeftResult.tried.join("\n  ")}`,
      );
    }
    if (!refRightResult.path) {
      bail(
        `Reference voice not found for "${speakerMap.rightName}" (--no-auto-refs set)`,
        `Provide ONE:\n  ${refRightResult.tried.join("\n  ")}`,
      );
    }
  }

  const providedRefs: ReferenceVoice[] = [];
  if (refLeftResult.path) {
    const buf = await readFile(refLeftResult.path);
    providedRefs.push({ id: speakerMap.leftId, displayLabel: speakerMap.leftName, audioBuffer: buf });
  }
  if (refRightResult.path) {
    const buf = await readFile(refRightResult.path);
    providedRefs.push({ id: speakerMap.rightId, displayLabel: speakerMap.rightName, audioBuffer: buf });
  }
  const missingCount = 2 - providedRefs.length;

  // 実行情報
  console.log("\n[correct-speakers] starting orchestrator");
  console.log(`  video        : ${args.video}`);
  console.log(`  segments     : ${segments.length}`);
  console.log(
    `  left         : ${speakerMap.leftName} (${speakerMap.leftId})  ` +
      `ref=${refLeftResult.path ? basename(refLeftResult.path) : "AUTO-EXTRACT"}`,
  );
  console.log(
    `  right        : ${speakerMap.rightName} (${speakerMap.rightId})  ` +
      `ref=${refRightResult.path ? basename(refRightResult.path) : "AUTO-EXTRACT"}`,
  );
  if (missingCount > 0) {
    console.log(`  refs to auto-extract: ${missingCount} / 2`);
  }
  console.log(`  out          : ${args.out}`);
  if (args.limitSeconds !== undefined) console.log(`  limit-seconds: ${args.limitSeconds}`);
  if (args.skipFrames) console.log(`  skip-frames  : true`);

  let lastPhase = "";
  const onProgress = (phase: string, done: number, total: number): void => {
    if (phase !== lastPhase) {
      process.stdout.write(`\n[phase] ${phase} `);
      lastPhase = phase;
    }
    if (done === total) {
      process.stdout.write(` (${done}/${total} done)`);
    } else if (done % 10 === 0) {
      process.stdout.write(".");
    }
  };

  let result: CorrectSpeakersOutput;
  try {
    result = await correctSpeakers({
      videoPath: args.video,
      segments,
      referenceVoices: providedRefs,
      speakerMap: {
        nameToId: speakerMap.nameToId,
        idToName: speakerMap.idToName,
        leftId: speakerMap.leftId,
        rightId: speakerMap.rightId,
      },
      geminiApiKey: geminiKey,
      workDir: args.workDir,
      options: {
        frameIntervalSec: 2,
        visionConcurrency: 5,
        audioConcurrency: 6,
        audioClipSec: 5,
        limitSeconds: args.limitSeconds,
        skipFrameExtraction: args.skipFrames,
        onProgress,
      },
    });
    process.stdout.write("\n");
  } catch (err) {
    process.stdout.write("\n");
    const msg = err instanceof Error ? err.message : String(err);
    bail(`correction failed: ${msg}`, "Check above logs for details", 2);
  }

  // 自動抽出した参照声を ref-dir にキャッシュ保存 (次回 CLI 実行時に再利用される)
  const cachedRefPaths: string[] = [];
  for (const r of result.autoExtractedReferences) {
    const userId =
      r.id === speakerMap.leftId
        ? (leftPart?.user_id ?? null)
        : r.id === speakerMap.rightId
          ? (rightPart?.user_id ?? null)
          : null;
    const saved = await saveExtractedRefToCache(args.refDir, r.id, userId, r.audioBuffer);
    cachedRefPaths.push(saved);
  }

  // corrections (verdict=tldv-wrong のみ抽出)
  const corrections: OutputCorrection[] = result.perSegment
    .filter((s) => s.verdict === "tldv-wrong" && s.correctedLabel !== s.tldvLabel)
    .map((s) => {
      const mm = String(Math.floor(s.startSec / 60)).padStart(2, "0");
      const ss = String(Math.floor(s.startSec) % 60).padStart(2, "0");
      return {
        idx: s.idx,
        time: `${mm}:${ss}`,
        originalLabel: s.tldvLabel,
        newLabel: s.correctedLabel,
        text: s.text,
      };
    });

  const output = {
    videoPath: args.video,
    mode: isManualMode ? ("manual" as const) : ("auto" as const),
    meetingId: resolvedMeetingId,
    tldvMeetingId,
    speakerMap: {
      left: { name: speakerMap.leftName, id: speakerMap.leftId },
      right: { name: speakerMap.rightName, id: speakerMap.rightId },
    },
    summary: {
      totalSegments: result.meta.totalSegments,
      correctedSegments: result.meta.correctedSegments,
      correctionConfidence: result.correctionConfidence,
      durationSec: result.meta.durationMs / 1000,
      visionFrames: result.meta.visionFrames,
      visionErrors: result.meta.visionErrors,
      audioCalls: result.meta.audioCalls,
      audioErrors: result.meta.audioErrors,
      audioFloorApplied: result.meta.audioFloorApplied,
    },
    correctedFullText: result.correctedFullText,
    correctedDbFullText: buildFullText(
      segments,
      result.perSegment.map((p) => p.correctedLabel),
    ),
    corrections,
    perSegment: result.perSegment,
    meta: result.meta,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== Summary ===");
  console.log(`  total segments     : ${output.summary.totalSegments}`);
  console.log(`  corrected segments : ${output.summary.correctedSegments}`);
  console.log(`  confidence         : ${output.summary.correctionConfidence.toFixed(3)}`);
  console.log(`  duration           : ${output.summary.durationSec.toFixed(1)} sec`);
  console.log(`  vision/audio errors: ${output.summary.visionErrors} / ${output.summary.audioErrors}`);

  if (corrections.length > 0) {
    console.log("\n=== Corrected Labels ===");
    for (const c of corrections.slice(0, 10)) {
      const shortText = c.text.length > 40 ? c.text.slice(0, 40) + "..." : c.text;
      console.log(`  ${c.time}  ${c.originalLabel} → ${c.newLabel}  ${shortText}`);
    }
    if (corrections.length > 10) {
      console.log(`  ... and ${corrections.length - 10} more`);
    }
  }

  if (cachedRefPaths.length > 0) {
    console.log("\n=== Auto-Extracted Reference Voices (cached) ===");
    for (let i = 0; i < result.autoExtractedReferences.length; i++) {
      const r = result.autoExtractedReferences[i];
      const path = cachedRefPaths[i];
      if (!r || !path) continue;
      const shortFlag = r.shortClip ? " (短: 8秒未満)" : "";
      console.log(
        `  ${r.id} (${r.displayLabel}): ${r.actualClipSec.toFixed(1)}s ` +
          `@ ${r.sourceRange.startSec}-${r.sourceRange.endSec}s${shortFlag}`,
      );
      console.log(`    saved: ${path}`);
    }
  }

  console.log(`\n[correct-speakers] saved: ${args.out}`);
}

main().catch((err) => {
  console.error("\n[correct-speakers] FATAL:", err);
  process.exit(2);
});
