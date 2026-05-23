// 3-way speaker correction の orchestrator。
//
// 副作用モジュール (ffmpeg / Gemini vision / Gemini audio) を順に呼んで
// 補正済み transcript を生成する。CLI / worker / 将来の UI から共通で使う。
//
// 設計判断:
//   - I/O はこの関数内に閉じ込める。テストは smoke test (8-) / e2e test (9-) で。
//   - 致命的: ffmpeg 失敗 / 参照声不在 / 全 Gemini エラー → throw
//   - 続行可: 個別 Gemini call の error → "unknown" 扱いで多数決
//   - サーキットブレーカ: vision または audio の error 率 > 30% で throw
//   - 出力は DB スキーマ (`corrected_full_text` + `correction_confidence` +
//     `correction_meta`) と一対一対応。

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { GoogleGenerativeAI } from "@google/generative-ai";

import {
  extractAudioClip,
  extractFrames,
  probeDuration,
} from "./ffmpeg";
import { classifyAudioClip, computeAudioExtractParams, type ReferenceVoice } from "./gemini-audio";
import { classifyFrameFile } from "./gemini-vision";
import {
  AUDIO_CONFIDENCE_FLOOR,
  aggregateConfidence,
  countVerdicts,
  decideCorrectedLabel,
  judgeSegment,
  type SegmentJudgment,
  type Verdict,
  type VerdictResult,
} from "./merge-3way";
import { runPool } from "./pool";
import {
  buildFullText,
  fillEndSec,
  type Segment,
} from "./transcript";
import { videoDominantInRange, type VideoTimelineItem } from "./timeline";

/** 補正実行のサーキットブレーカ閾値 (0.3 = 30% エラーで打ち切り) */
export const CIRCUIT_BREAKER_ERROR_RATE = 0.3;

/** 進捗 phase。CLI / UI でユーザに何を待っているか伝える用。 */
export type CorrectionPhase =
  | "probe"
  | "extract-frames"
  | "classify-frames"
  | "classify-audio"
  | "merge"
  | "build-output";

export interface CorrectSpeakersInput {
  /** mp4 等の動画ファイル絶対パス */
  videoPath: string;
  /** 事前パース済みセグメント (CLI 側で transcript.txt or tldv API から作る) */
  segments: Segment[];
  /** 参照声サンプル (id, displayLabel, audioBuffer) */
  referenceVoices: ReferenceVoice[];
  /** 名前/ID マッピング */
  speakerMap: {
    /** tldv の生 speaker 文字列 → 正規化 ID */
    nameToId: Record<string, string>;
    /** 正規化 ID → 表示名 (補正後ラベル復元用) */
    idToName: Record<string, string>;
    /** 動画の左タイルの正規化 ID */
    leftId: string;
    /** 右タイルの正規化 ID */
    rightId: string;
  };
  /** Gemini API key */
  geminiApiKey: string;
  /** フレーム/音声クリップ等の一時 dir (存在しなければ作る) */
  workDir: string;
  options?: {
    /** デフォルト 2 秒ごとに 1 フレーム */
    frameIntervalSec?: number;
    /** vision 並列度。デフォルト 5 */
    visionConcurrency?: number;
    /** audio 並列度。デフォルト 6 */
    audioConcurrency?: number;
    /** 音声クリップの目標長 (秒)。デフォルト 5 */
    audioClipSec?: number;
    /** 既存フレームを再利用 (extractFrames 自体をスキップ) */
    skipFrameExtraction?: boolean;
    /** 進捗 callback */
    onProgress?: (phase: CorrectionPhase, done: number, total: number) => void;
  };
}

export interface SegmentCorrection {
  idx: number;
  startSec: number;
  endSec: number;
  text: string;
  /** tldv 生ラベル (生名) */
  tldvLabel: string;
  /** 正規化 ID */
  tldv: string;
  video: string;
  audio: string;
  audioConfidence: number;
  verdict: Verdict;
  trueSpeaker: string;
  /** 最終採用ラベル (生名)。verdict が tldv-wrong のときだけ補正された名前 */
  correctedLabel: string;
}

export interface CorrectionMeta {
  counts: Record<Verdict, number>;
  totalSegments: number;
  correctedSegments: number; // verdict === "tldv-wrong" の件数
  visionFrames: number;
  visionErrors: number;
  audioCalls: number;
  audioErrors: number;
  audioFloorApplied: number; // audioConfidence < FLOOR のセグメント数
  referenceVoiceIds: string[];
  model: { vision: string; audio: string };
  durationMs: number;
}

export interface CorrectSpeakersOutput {
  /** [speaker]: text 改行 join 形式 (= meeting_transcripts.full_text と同形式) */
  correctedFullText: string;
  /** 0.0-1.0 */
  correctionConfidence: number;
  meta: CorrectionMeta;
  perSegment: SegmentCorrection[];
}

/**
 * 3-way speaker correction を実行。 詳細は ファイル冒頭コメント参照。
 *
 * @throws ffmpeg / Gemini / 致命的構成エラー
 */
export async function correctSpeakers(
  input: CorrectSpeakersInput,
): Promise<CorrectSpeakersOutput> {
  const t0 = Date.now();
  const opts = input.options ?? {};
  const frameIntervalSec = opts.frameIntervalSec ?? 2;
  const visionConcurrency = opts.visionConcurrency ?? 5;
  const audioConcurrency = opts.audioConcurrency ?? 6;
  const audioClipSec = opts.audioClipSec ?? 5;
  const onProgress = opts.onProgress ?? (() => {});

  if (input.referenceVoices.length === 0) {
    throw new Error("correctSpeakers: at least one reference voice required");
  }
  if (input.segments.length === 0) {
    throw new Error("correctSpeakers: no transcript segments");
  }

  // 1) 動画の長さを取得して、最後のセグメント endSec の fallback にする
  onProgress("probe", 0, 1);
  const videoDurationSec = await probeDuration(input.videoPath);
  onProgress("probe", 1, 1);

  const segments = fillEndSec(input.segments, videoDurationSec);

  // 2) フレーム抽出 (skip 可)
  const framesDir = join(input.workDir, "frames");
  if (!opts.skipFrameExtraction) {
    onProgress("extract-frames", 0, 1);
    await mkdir(input.workDir, { recursive: true });
    await extractFrames({
      input: input.videoPath,
      outDir: framesDir,
      everySec: frameIntervalSec,
    });
    onProgress("extract-frames", 1, 1);
  }

  // 3) フレーム一覧 → vision API で active speaker 判定
  const frameFiles = (await readdir(framesDir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  if (frameFiles.length === 0) {
    throw new Error(`correctSpeakers: no frames in ${framesDir}`);
  }

  const client = new GoogleGenerativeAI(input.geminiApiKey);

  const visionResults = await runPool(
    frameFiles,
    visionConcurrency,
    async (file, idx) => {
      const res = await classifyFrameFile(client, join(framesDir, file));
      // frame_NNNNN.jpg → timestampSec = (NNNNN - 1) * frameIntervalSec
      const m = file.match(/frame_(\d+)\.jpg$/);
      const frameIndex = m ? parseInt(m[1] ?? "0", 10) : idx + 1;
      const timestampSec = (frameIndex - 1) * frameIntervalSec;
      const item: VideoTimelineItem = {
        frameIndex,
        timestampSec,
        speaker: res.speaker,
        confidence: res.confidence,
        reason: res.reason,
      };
      return { item, isError: res.speaker === "error" };
    },
    (done, total) => onProgress("classify-frames", done, total),
  );

  const timeline = visionResults.map((r) => r.item);
  const visionErrors = visionResults.filter((r) => r.isError).length;
  if (visionErrors / visionResults.length > CIRCUIT_BREAKER_ERROR_RATE) {
    throw new Error(
      `correctSpeakers: vision error rate ${(visionErrors / visionResults.length).toFixed(2)} ` +
        `exceeds circuit breaker ${CIRCUIT_BREAKER_ERROR_RATE}`,
    );
  }

  // 4) セグメントごとに音声クリップ抽出 → audio API で声紋照合
  const audioResults = await runPool(
    segments,
    audioConcurrency,
    async (seg, idx) => {
      const endSec = seg.endSec ?? videoDurationSec;
      const params = computeAudioExtractParams(seg.startSec, endSec, audioClipSec);
      const clip = await extractAudioClip({
        video: input.videoPath,
        startSec: params.startSec,
        durationSec: params.durationSec,
      });
      const res = await classifyAudioClip(client, clip, input.referenceVoices);
      return { idx, res, isError: res.speaker === "error" };
    },
    (done, total) => onProgress("classify-audio", done, total),
  );

  const audioErrors = audioResults.filter((r) => r.isError).length;
  if (audioErrors / audioResults.length > CIRCUIT_BREAKER_ERROR_RATE) {
    throw new Error(
      `correctSpeakers: audio error rate ${(audioErrors / audioResults.length).toFixed(2)} ` +
        `exceeds circuit breaker ${CIRCUIT_BREAKER_ERROR_RATE}`,
    );
  }

  // 5) 3-way 多数決
  onProgress("merge", 0, segments.length);

  const sideToId = (side: "left" | "right" | "unknown"): string => {
    if (side === "left") return input.speakerMap.leftId;
    if (side === "right") return input.speakerMap.rightId;
    return "unknown";
  };

  const perSegment: SegmentCorrection[] = [];
  const verdictResults: VerdictResult[] = [];
  let audioFloorApplied = 0;

  const audioResultByIdx = new Map(audioResults.map((r) => [r.idx, r.res]));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const endSec = seg.endSec ?? videoDurationSec;
    const tldv = input.speakerMap.nameToId[seg.speaker] ?? "unknown";
    const videoSide = videoDominantInRange(timeline, seg.startSec, endSec);
    const video = sideToId(videoSide);
    const audioRes = audioResultByIdx.get(i);
    const audio = audioRes && (audioRes.speaker !== "error")
      ? audioRes.speaker
      : "unknown";
    const audioConfidence = audioRes?.confidence ?? 0;

    if (audioConfidence < AUDIO_CONFIDENCE_FLOOR && audio !== "unknown") {
      audioFloorApplied++;
    }

    const judgment: SegmentJudgment = {
      tldv,
      video,
      audio,
      audioConfidence,
    };
    const verdict = judgeSegment(judgment);
    verdictResults.push(verdict);

    const correctedLabel = decideCorrectedLabel(
      seg.speaker,
      verdict.verdict,
      verdict.trueSpeaker,
      input.speakerMap.idToName,
    );

    perSegment.push({
      idx: i,
      startSec: seg.startSec,
      endSec,
      text: seg.text,
      tldvLabel: seg.speaker,
      tldv,
      video,
      audio,
      audioConfidence,
      verdict: verdict.verdict,
      trueSpeaker: verdict.trueSpeaker,
      correctedLabel,
    });

    onProgress("merge", i + 1, segments.length);
  }

  // 6) 出力組み立て
  onProgress("build-output", 0, 1);
  const correctedFullText = buildFullText(
    segments,
    perSegment.map((p) => p.correctedLabel),
  );
  const correctionConfidence = aggregateConfidence(verdictResults);
  const counts = countVerdicts(verdictResults);
  const correctedSegments = perSegment.filter((p) => p.verdict === "tldv-wrong").length;

  const meta: CorrectionMeta = {
    counts,
    totalSegments: segments.length,
    correctedSegments,
    visionFrames: visionResults.length,
    visionErrors,
    audioCalls: audioResults.length,
    audioErrors,
    audioFloorApplied,
    referenceVoiceIds: input.referenceVoices.map((r) => r.id),
    model: { vision: "gemini-2.5-flash-lite", audio: "gemini-2.5-flash" },
    durationMs: Date.now() - t0,
  };

  onProgress("build-output", 1, 1);

  return {
    correctedFullText,
    correctionConfidence,
    meta,
    perSegment,
  };
}
