import { describe, expect, it } from "vitest";

import {
  findAgreementRanges,
  selectLongestAgreementPerSpeaker,
  type AgreementRange,
} from "./ref-voice";
import type { Segment } from "./transcript";
import type { VideoSide, VideoTimelineItem } from "./timeline";

// テストヘルパ: VideoSide を id に変換 (固定マッピング)
const sideToId = (side: VideoSide): string => {
  if (side === "left") return "tajima";
  if (side === "right") return "sara";
  return "unknown";
};

const nameToId: Record<string, string> = {
  "田島康平": "tajima",
  "connect inter": "sara",
};

function makeSeg(
  speaker: string,
  startSec: number,
  endSec: number,
  text = "",
): Segment {
  return { speaker, startSec, endSec, text };
}

/**
 * range の中で speaker = left/right の連続を作るためのヘルパ。
 * 各 (timestampSec) で speaker が判定済みの timeline を返す。
 */
function makeTimeline(
  entries: Array<[number, "left" | "right" | "none" | "both" | "error"]>,
): VideoTimelineItem[] {
  return entries.map(([t, s], i) => ({
    frameIndex: i + 1,
    timestampSec: t,
    speaker: s,
    confidence: 1,
  }));
}

describe("findAgreementRanges", () => {
  it("通常: 全 6 セグメント、各話者の連続一致を検出", () => {
    // idx 0-1: tajima 一致 (連続)
    // idx 2: 不一致
    // idx 3-4: sara 一致 (連続)
    // idx 5: 不一致
    const segments = [
      makeSeg("田島康平", 0, 10),
      makeSeg("田島康平", 10, 20),
      makeSeg("田島康平", 20, 30),
      makeSeg("connect inter", 30, 40),
      makeSeg("connect inter", 40, 50),
      makeSeg("田島康平", 50, 60),
    ];
    // timeline: 0-20s left (tajima), 20-30s right (sara mismatch tldv), 30-50s right (sara), 50-60s right (sara mismatch tldv)
    const timeline = makeTimeline([
      [0, "left"],
      [10, "left"],
      [20, "right"],
      [30, "right"],
      [40, "right"],
      [50, "right"],
    ]);

    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 60,
    });

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({
      speakerId: "tajima",
      startSec: 0,
      endSec: 20,
      durationSec: 20,
      segmentIndices: [0, 1],
    });
    expect(ranges[1]).toMatchObject({
      speakerId: "sara",
      startSec: 30,
      endSec: 50,
      durationSec: 20,
      segmentIndices: [3, 4],
    });
  });

  it("一致区間ゼロ: 空配列を返す", () => {
    const segments = [
      makeSeg("田島康平", 0, 10),
      makeSeg("connect inter", 10, 20),
    ];
    // timeline は全部 mismatch
    const timeline = makeTimeline([
      [0, "right"], // tldv=tajima, video=sara → mismatch
      [10, "left"], // tldv=sara, video=tajima → mismatch
    ]);
    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 20,
    });
    expect(ranges).toEqual([]);
  });

  it("片方しか一致しない: 片方のみ返す", () => {
    const segments = [
      makeSeg("田島康平", 0, 10),
      makeSeg("connect inter", 10, 20),
    ];
    const timeline = makeTimeline([
      [0, "left"], // tajima 一致
      [10, "left"], // sara 不一致
    ]);
    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 20,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.speakerId).toBe("tajima");
  });

  it("不一致で区切られる: 連続が分割される", () => {
    // tajima → mismatch → tajima のパターン
    const segments = [
      makeSeg("田島康平", 0, 10), // 一致
      makeSeg("田島康平", 10, 20), // 不一致 (video が right)
      makeSeg("田島康平", 20, 30), // 一致
    ];
    const timeline = makeTimeline([
      [0, "left"],
      [10, "right"], // 不一致
      [20, "left"],
    ]);
    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 30,
    });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ speakerId: "tajima", startSec: 0, endSec: 10 });
    expect(ranges[1]).toMatchObject({ speakerId: "tajima", startSec: 20, endSec: 30 });
  });

  it("nameToId に無い speaker は unknown 扱いで break する", () => {
    const segments = [
      makeSeg("田島康平", 0, 10),
      makeSeg("見知らぬ人", 10, 20), // nameToId に無い
      makeSeg("田島康平", 20, 30),
    ];
    const timeline = makeTimeline([
      [0, "left"],
      [10, "left"],
      [20, "left"],
    ]);
    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 30,
    });
    expect(ranges).toHaveLength(2); // 中間で break
    expect(ranges[0]?.segmentIndices).toEqual([0]);
    expect(ranges[1]?.segmentIndices).toEqual([2]);
  });

  it("末尾セグメントの一致も検出される", () => {
    const segments = [
      makeSeg("田島康平", 0, 10),
      makeSeg("田島康平", 10, 20),
    ];
    const timeline = makeTimeline([
      [0, "left"],
      [10, "left"],
    ]);
    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 20,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.endSec).toBe(20);
  });

  it("video が unknown (left/right ともに 0) なら不一致扱い", () => {
    const segments = [makeSeg("田島康平", 0, 10)];
    const timeline = makeTimeline([
      [0, "none"],
      [2, "none"],
      [4, "none"],
    ]);
    const ranges = findAgreementRanges({
      segments,
      timeline,
      nameToId,
      sideToId,
      videoDurationSec: 10,
    });
    expect(ranges).toEqual([]);
  });
});

describe("selectLongestAgreementPerSpeaker", () => {
  const ranges: AgreementRange[] = [
    { speakerId: "tajima", startSec: 0, endSec: 10, durationSec: 10, segmentIndices: [0] },
    { speakerId: "tajima", startSec: 30, endSec: 60, durationSec: 30, segmentIndices: [3] },
    { speakerId: "tajima", startSec: 70, endSec: 78, durationSec: 8, segmentIndices: [7] },
    { speakerId: "sara", startSec: 100, endSec: 115, durationSec: 15, segmentIndices: [10] },
    { speakerId: "sara", startSec: 200, endSec: 205, durationSec: 5, segmentIndices: [20] },
  ];

  it("各話者の最長一致を返す (8 秒以上)", () => {
    const result = selectLongestAgreementPerSpeaker(ranges, ["tajima", "sara"], 8);
    expect(result.get("tajima")?.durationSec).toBe(30);
    expect(result.get("sara")?.durationSec).toBe(15);
  });

  it("minDuration を下回るものは除外", () => {
    const result = selectLongestAgreementPerSpeaker(ranges, ["tajima", "sara"], 10);
    expect(result.get("tajima")?.durationSec).toBe(30);
    expect(result.get("sara")?.durationSec).toBe(15);
  });

  it("minDuration が高くて 1 つも残らない話者は Map に含まれない", () => {
    const result = selectLongestAgreementPerSpeaker(ranges, ["tajima", "sara"], 20);
    expect(result.get("tajima")?.durationSec).toBe(30);
    expect(result.has("sara")).toBe(false);
  });

  it("speakerIds に含まれない range は無視", () => {
    const result = selectLongestAgreementPerSpeaker(ranges, ["tajima"], 8);
    expect(result.size).toBe(1);
    expect(result.has("sara")).toBe(false);
  });
});
