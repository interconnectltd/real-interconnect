// video timeline (フレームごとの active speaker 判定列) から、
// セグメント [startSec, endSec) の支配的話者を多数決で算出。

export type VideoSpeaker = "left" | "right" | "both" | "none" | "error";

export interface VideoTimelineItem {
  frameIndex: number;
  timestampSec: number;
  speaker: VideoSpeaker;
  confidence: number;
  reason?: string;
}

export type VideoSide = "left" | "right" | "unknown";

/**
 * timeline のうち `[startSec, endSec)` に該当するフレームを集めて、
 * left / right の多数決で side を返す。
 * - both / none / error は集計対象外
 * - 同数 or 該当フレーム無しは "unknown"
 */
export function videoDominantInRange(
  timeline: ReadonlyArray<VideoTimelineItem>,
  startSec: number,
  endSec: number,
): VideoSide {
  let left = 0;
  let right = 0;
  for (const t of timeline) {
    if (t.timestampSec < startSec || t.timestampSec >= endSec) continue;
    if (t.speaker === "left") left++;
    else if (t.speaker === "right") right++;
  }
  if (left === 0 && right === 0) return "unknown";
  if (left > right) return "left";
  if (right > left) return "right";
  return "unknown";
}

/**
 * 「セグメント内の中央 3 フレームの time stamp」を返す。フレーム抽出を
 * セグメント単位で行うときに、5 → 3 フレーム化したい場合に使う
 * (= 「video 全通し、ただしフレーム数だけ間引く」改善)。
 *
 * セグメントが短くて 3 フレーム取れない場合は取れるだけ返す。
 */
export function pickFrameTimestamps(
  startSec: number,
  endSec: number,
  count = 3,
): number[] {
  const duration = endSec - startSec;
  if (duration <= 0 || count <= 0) return [];
  if (count === 1) return [startSec + duration / 2];
  const stops: number[] = [];
  // count=3 なら 1/4, 2/4, 3/4 の位置でサンプル (端は被り発話で他者の声が
  // 混じりやすいので避ける)
  for (let i = 1; i <= count; i++) {
    stops.push(startSec + (duration * i) / (count + 1));
  }
  return stops;
}
