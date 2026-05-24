// 参照声の自動抽出。
//
// tldv ラベルと video 判定 (Gemini vision) が両方一致するセグメント区間を
// 「真の話者」とみなし、各話者の最長一致区間から音声クリップを切り出して
// 参照声サンプルとする。
//
// PoC sample-meeting-2 の実データ (3way-report.json) では:
//   - tldv-video 一致セグメント: 24/60 件
//   - tajima 8 秒以上の一致: 8 個 (最長 25 秒)
//   - sara 8 秒以上の一致: 11 個 (最長 71 秒)
// → 自動抽出は十分成立する。

import { extractAudioClip } from "./ffmpeg";
import type { ReferenceVoice } from "./gemini-audio";
import type { Segment } from "./transcript";
import { videoDominantInRange, type VideoSide, type VideoTimelineItem } from "./timeline";

/** 推奨参照声クリップ長 (秒) */
export const REF_VOICE_TARGET_SEC = 12;
/** 最低許容長 (これ未満は警告) */
export const REF_VOICE_MIN_SEC = 8;
/**
 * 1 セグメントが寄与できる最大長 (秒)。
 * transcript の最終セグメントが fillEndSec で videoDuration まで伸ばされた場合、
 * 何百秒もの「ゴースト範囲」が作られる事を防ぐ。
 * 60s = 1 セグメントの一般的な発話長を大きく超えるが、現実的な上限。
 */
export const MAX_SEGMENT_CONTRIBUTION_SEC = 60;

/**
 * 「tldv ラベルと video 判定が一致するセグメント」の連続結合区間。
 * 各話者の参照声候補。
 */
export interface AgreementRange {
  speakerId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  segmentIndices: number[];
}

export interface FindAgreementRangesInput {
  segments: Segment[];
  timeline: ReadonlyArray<VideoTimelineItem>;
  nameToId: Readonly<Record<string, string>>;
  /** "left" | "right" → 正規化 ID へのマップ */
  sideToId: (side: VideoSide) => string;
  /** 動画全長 (秒)。最後のセグメント endSec が欠けてる場合の fallback */
  videoDurationSec: number;
}

/**
 * セグメントを順に走査し、tldv-id と video-id が一致するものを「同じ話者なら結合」
 * して連続区間を返す。 unknown (どちらかが判定不能) は break として扱う。
 *
 * pure 関数。ffmpeg / API 呼び出しなし。
 */
export function findAgreementRanges(input: FindAgreementRangesInput): AgreementRange[] {
  const result: AgreementRange[] = [];
  let current: AgreementRange | null = null;

  for (let i = 0; i < input.segments.length; i++) {
    const seg = input.segments[i];
    if (!seg) continue;

    const tldvId = input.nameToId[seg.speaker];
    if (!tldvId) {
      // tldv ラベルがマップに無い → 一致なし
      if (current) {
        result.push(current);
        current = null;
      }
      continue;
    }

    const rawEndSec = seg.endSec ?? input.videoDurationSec;
    // セグメントの寄与長を MAX_SEGMENT_CONTRIBUTION_SEC で cap
    // (fillEndSec が videoDuration を入れた末尾セグメントによる過大寄与を防ぐ)
    const effectiveEndSec = Math.min(rawEndSec, seg.startSec + MAX_SEGMENT_CONTRIBUTION_SEC);
    const videoSide = videoDominantInRange(input.timeline, seg.startSec, effectiveEndSec);
    const videoId = videoSide === "unknown" ? "unknown" : input.sideToId(videoSide);

    const agrees = videoId !== "unknown" && tldvId === videoId;

    if (agrees) {
      if (current && current.speakerId === tldvId) {
        // 連続: 区間を拡張
        current.endSec = effectiveEndSec;
        current.durationSec = current.endSec - current.startSec;
        current.segmentIndices.push(i);
      } else {
        // 新規開始 (or 別話者に切り替わり)
        if (current) result.push(current);
        current = {
          speakerId: tldvId,
          startSec: seg.startSec,
          endSec: effectiveEndSec,
          durationSec: effectiveEndSec - seg.startSec,
          segmentIndices: [i],
        };
      }
    } else if (current) {
      // 不一致: 区間 close
      result.push(current);
      current = null;
    }
  }
  if (current) result.push(current);
  return result;
}

/**
 * 各話者の中で最長の一致区間を 1 つだけ選ぶ。 minDuration 未満しか取れない話者は
 * Map に含めない (caller で「片方しか取れない」エラーを出す前提)。
 *
 * pure 関数。
 */
export function selectLongestAgreementPerSpeaker(
  ranges: ReadonlyArray<AgreementRange>,
  speakerIds: ReadonlyArray<string>,
  minDurationSec: number,
): Map<string, AgreementRange> {
  const longest = new Map<string, AgreementRange>();
  for (const r of ranges) {
    if (!speakerIds.includes(r.speakerId)) continue;
    if (r.durationSec < minDurationSec) continue;
    const prev = longest.get(r.speakerId);
    if (!prev || r.durationSec > prev.durationSec) {
      longest.set(r.speakerId, r);
    }
  }
  return longest;
}

export interface ExtractReferenceVoicesInput {
  videoPath: string;
  segments: Segment[];
  timeline: ReadonlyArray<VideoTimelineItem>;
  nameToId: Readonly<Record<string, string>>;
  idToName: Readonly<Record<string, string>>;
  sideToId: (side: VideoSide) => string;
  /** 抽出対象の話者 ID リスト */
  speakerIds: ReadonlyArray<string>;
  videoDurationSec: number;
  /** クリップ長 (秒) 上限。デフォルト 12 秒 */
  clipSec?: number;
  /** 最低許容長。これ未満なら warning。デフォルト 8 秒 */
  minClipSec?: number;
}

export interface ExtractedReferenceVoice extends ReferenceVoice {
  /** 抽出元の区間 */
  sourceRange: AgreementRange;
  /** 実際に切り出された長さ (秒) */
  actualClipSec: number;
  /** minClipSec を下回った場合 true (品質警告) */
  shortClip: boolean;
}

export interface ExtractReferenceVoicesResult {
  voices: ExtractedReferenceVoice[];
  /** 抽出できなかった speakerId */
  missing: string[];
}

/**
 * tldv-video 一致区間から各話者の参照声を ffmpeg で切り出して返す。
 *
 * 副作用: ffmpeg を呼ぶ。
 * 失敗: 「全話者の最低 1 つ抽出不可」は throw、「一部失敗」は missing で返す。
 */
export async function extractReferenceVoicesFromVideo(
  input: ExtractReferenceVoicesInput,
): Promise<ExtractReferenceVoicesResult> {
  const clipSec = input.clipSec ?? REF_VOICE_TARGET_SEC;
  const minClipSec = input.minClipSec ?? REF_VOICE_MIN_SEC;

  const ranges = findAgreementRanges({
    segments: input.segments,
    timeline: input.timeline,
    nameToId: input.nameToId,
    sideToId: input.sideToId,
    videoDurationSec: input.videoDurationSec,
  });

  // まず推奨長で最長を探す。 minDuration には minClipSec を使う。
  const longest = selectLongestAgreementPerSpeaker(ranges, input.speakerIds, minClipSec);

  const voices: ExtractedReferenceVoice[] = [];
  const missing: string[] = [];

  for (const speakerId of input.speakerIds) {
    const range = longest.get(speakerId);
    if (!range) {
      missing.push(speakerId);
      continue;
    }

    // 区間中央から clipSec 秒切り出す (PoC の audio clip 抽出と同じ方針)
    const actualClipSec = Math.min(clipSec, range.durationSec);
    const startSec = range.startSec + Math.max(0, (range.durationSec - actualClipSec) / 2);

    const audioBuffer = await extractAudioClip({
      video: input.videoPath,
      startSec,
      durationSec: actualClipSec,
    });

    voices.push({
      id: speakerId,
      displayLabel: input.idToName[speakerId] ?? speakerId,
      audioBuffer,
      sourceRange: range,
      actualClipSec,
      shortClip: actualClipSec < minClipSec,
    });
  }

  if (voices.length === 0) {
    throw new Error(
      `extractReferenceVoicesFromVideo: no agreement ranges found for any speaker ` +
        `(speakerIds=${input.speakerIds.join(",")})`,
    );
  }

  return { voices, missing };
}
