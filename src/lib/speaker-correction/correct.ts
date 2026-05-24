// 3-way speaker correction の orchestrator。
//
// 副作用モジュール (ffmpeg / Gemini vision / Gemini audio) を順に呼んで
// 補正済み transcript を生成する。CLI / worker / 将来の UI から共通で使う。
//
// 設計判断:
//   - I/O はこの関数内に閉じ込める。テストは smoke test (8-) / e2e test (9-) で。
//   - 致命的: ffmpeg 失敗 / 全 Gemini エラー → throw
//   - 続行可: 個別 Gemini call の error → "unknown" 扱いで多数決
//   - サーキットブレーカ: vision または audio の error 率 > 30% で throw
//   - 出力は DB スキーマ (`corrected_full_text` + `correction_confidence` +
//     `correction_meta`) と一対一対応。
//   - **参照声の自動抽出 (Day 3b)**: referenceVoices を省略 or 部分指定すると、
//     classify-frames 完了後に tldv-video 一致区間から自動抽出して埋める。
//     これにより CLI は「動画 1 ファイル」だけで補正を回せる。

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
  extractReferenceVoicesFromVideo,
  type ExtractedReferenceVoice,
} from "./ref-voice";
import {
  buildFullText,
  fillEndSec,
  type Segment,
} from "./transcript";
import { videoDominantInRange, type VideoTimelineItem, type VideoSide } from "./timeline";

/** 補正実行のサーキットブレーカ閾値 (0.3 = 30% エラーで打ち切り) */
export const CIRCUIT_BREAKER_ERROR_RATE = 0.3;

/** 進捗 phase。CLI / UI でユーザに何を待っているか伝える用。 */
export type CorrectionPhase =
  | "probe"
  | "extract-frames"
  | "classify-frames"
  | "extract-refs"
  | "classify-audio"
  | "merge"
  | "build-output";

export interface CorrectSpeakersInput {
  /** mp4 等の動画ファイル絶対パス */
  videoPath: string;
  /** 事前パース済みセグメント (CLI 側で transcript.txt or tldv API から作る) */
  segments: Segment[];
  /**
   * 参照声サンプル (id, displayLabel, audioBuffer)。
   * 省略時は tldv-video 一致区間から自動抽出する (Day 3b)。
   * 部分指定 (片方だけ) も可能で、不足分のみ自動抽出。
   */
  referenceVoices?: ReferenceVoice[];
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
    /** フレーム抽出を最初の N 秒に制限 (テスト/長尺対策) */
    limitSeconds?: number;
    /** vision 並列度。デフォルト 5 */
    visionConcurrency?: number;
    /** audio 並列度。デフォルト 6 */
    audioConcurrency?: number;
    /** 音声クリップの目標長 (秒)。デフォルト 5 */
    audioClipSec?: number;
    /** 既存フレームを再利用 (extractFrames 自体をスキップ) */
    skipFrameExtraction?: boolean;
    /**
     * 既存の video timeline を再利用 (vision phase 全体を skip)。
     * 解決案 C のための入口。 提供されたら frames も classify-frames も実行しない。
     */
    precomputedTimeline?: VideoTimelineItem[];
    /** 自動抽出参照声のクリップ目標長 (秒)。デフォルト 12 */
    refVoiceClipSec?: number;
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
  /** 自動抽出した参照声の ID (空配列 = 全て手動指定) */
  autoExtractedRefIds: string[];
  /** 自動抽出した参照声のメタ情報 (どの区間から取ったか) */
  autoExtractedRefRanges: Array<{
    speakerId: string;
    startSec: number;
    endSec: number;
    durationSec: number;
    actualClipSec: number;
    shortClip: boolean;
  }>;
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
  /** 自動抽出された参照声 (CLI 側でファイルキャッシュする用) */
  autoExtractedReferences: ExtractedReferenceVoice[];
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
  const refVoiceClipSec = opts.refVoiceClipSec ?? 12;
  const onProgress = opts.onProgress ?? (() => {});

  if (input.segments.length === 0) {
    throw new Error("correctSpeakers: no transcript segments");
  }

  // 1) 動画の長さを取得して、最後のセグメント endSec の fallback にする
  onProgress("probe", 0, 1);
  const videoDurationSec = await probeDuration(input.videoPath);
  onProgress("probe", 1, 1);

  const segments = fillEndSec(input.segments, videoDurationSec);
  const client = new GoogleGenerativeAI(input.geminiApiKey);

  // 2) フレーム抽出 + 3) vision 判定。 precomputed timeline 提供時は完全 skip。
  let timeline: VideoTimelineItem[];
  let visionFrames: number;
  let visionErrors: number;

  if (opts.precomputedTimeline && opts.precomputedTimeline.length > 0) {
    timeline = [...opts.precomputedTimeline];
    visionFrames = timeline.length;
    visionErrors = timeline.filter((t) => t.speaker === "error").length;
  } else {
    const framesDir = join(input.workDir, "frames");
    if (!opts.skipFrameExtraction) {
      onProgress("extract-frames", 0, 1);
      await mkdir(input.workDir, { recursive: true });
      await extractFrames({
        input: input.videoPath,
        outDir: framesDir,
        everySec: frameIntervalSec,
        limitSeconds: opts.limitSeconds,
      });
      onProgress("extract-frames", 1, 1);
    }

    const frameFiles = (await readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    if (frameFiles.length === 0) {
      throw new Error(`correctSpeakers: no frames in ${framesDir}`);
    }

    const visionResults = await runPool(
      frameFiles,
      visionConcurrency,
      async (file, idx) => {
        const res = await classifyFrameFile(client, join(framesDir, file));
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

    timeline = visionResults.map((r) => r.item);
    visionFrames = visionResults.length;
    visionErrors = visionResults.filter((r) => r.isError).length;
    if (visionErrors / visionResults.length > CIRCUIT_BREAKER_ERROR_RATE) {
      throw new Error(
        `correctSpeakers: vision error rate ${(visionErrors / visionResults.length).toFixed(2)} ` +
          `exceeds circuit breaker ${CIRCUIT_BREAKER_ERROR_RATE}`,
      );
    }
  }

  const sideToId = (side: VideoSide): string => {
    if (side === "left") return input.speakerMap.leftId;
    if (side === "right") return input.speakerMap.rightId;
    return "unknown";
  };

  // 3.5) 参照声の解決: 提供された refs + 不足分は tldv-video 一致区間から自動抽出
  const providedRefs = input.referenceVoices ?? [];
  const providedIds = new Set(providedRefs.map((r) => r.id));
  const requiredIds = [input.speakerMap.leftId, input.speakerMap.rightId];
  const missingIds = requiredIds.filter((id) => !providedIds.has(id));

  let autoExtractedReferences: ExtractedReferenceVoice[] = [];
  if (missingIds.length > 0) {
    onProgress("extract-refs", 0, missingIds.length);
    const result = await extractReferenceVoicesFromVideo({
      videoPath: input.videoPath,
      segments,
      timeline,
      nameToId: input.speakerMap.nameToId,
      idToName: input.speakerMap.idToName,
      sideToId,
      speakerIds: missingIds,
      videoDurationSec,
      clipSec: refVoiceClipSec,
    });

    if (result.missing.length > 0) {
      throw new Error(
        `correctSpeakers: could not extract reference voices for: ${result.missing.join(", ")}. ` +
          `Either tldv has no agreement zones for these speakers, or you must provide them manually.`,
      );
    }
    autoExtractedReferences = result.voices;
    onProgress("extract-refs", missingIds.length, missingIds.length);
  }

  const allReferenceVoices: ReferenceVoice[] = [...providedRefs, ...autoExtractedReferences];

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
      const res = await classifyAudioClip(client, clip, allReferenceVoices);
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
    const audio = audioRes && audioRes.speaker !== "error" ? audioRes.speaker : "unknown";
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
    visionFrames,
    visionErrors,
    audioCalls: audioResults.length,
    audioErrors,
    audioFloorApplied,
    referenceVoiceIds: allReferenceVoices.map((r) => r.id),
    autoExtractedRefIds: autoExtractedReferences.map((r) => r.id),
    autoExtractedRefRanges: autoExtractedReferences.map((r) => ({
      speakerId: r.id,
      startSec: r.sourceRange.startSec,
      endSec: r.sourceRange.endSec,
      durationSec: r.sourceRange.durationSec,
      actualClipSec: r.actualClipSec,
      shortClip: r.shortClip,
    })),
    model: { vision: "gemini-2.5-flash-lite", audio: "gemini-2.5-flash" },
    durationMs: Date.now() - t0,
  };

  onProgress("build-output", 1, 1);

  return {
    correctedFullText,
    correctionConfidence,
    meta,
    perSegment,
    autoExtractedReferences,
  };
}
