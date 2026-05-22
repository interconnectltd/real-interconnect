import { describe, expect, it } from "vitest";

import {
  pickFrameTimestamps,
  videoDominantInRange,
  type VideoTimelineItem,
} from "./timeline";

function makeItems(entries: Array<[number, "left" | "right" | "both" | "none" | "error"]>): VideoTimelineItem[] {
  return entries.map(([t, s], i) => ({
    frameIndex: i + 1,
    timestampSec: t,
    speaker: s,
    confidence: 1,
  }));
}

describe("videoDominantInRange", () => {
  it("range 内で left が多ければ left", () => {
    const items = makeItems([
      [0, "left"],
      [2, "left"],
      [4, "right"],
      [6, "left"],
    ]);
    expect(videoDominantInRange(items, 0, 8)).toBe("left");
  });

  it("right が多ければ right", () => {
    const items = makeItems([
      [0, "left"],
      [2, "right"],
      [4, "right"],
      [6, "right"],
    ]);
    expect(videoDominantInRange(items, 0, 8)).toBe("right");
  });

  it("同数なら unknown", () => {
    const items = makeItems([
      [0, "left"],
      [2, "left"],
      [4, "right"],
      [6, "right"],
    ]);
    expect(videoDominantInRange(items, 0, 8)).toBe("unknown");
  });

  it("range 外のフレームは無視", () => {
    const items = makeItems([
      [0, "left"],
      [2, "left"],
      [10, "right"], // 範囲外
      [12, "right"], // 範囲外
    ]);
    expect(videoDominantInRange(items, 0, 8)).toBe("left");
  });

  it("none / both / error は集計対象外", () => {
    const items = makeItems([
      [0, "none"],
      [2, "both"],
      [4, "error"],
      [6, "left"],
    ]);
    expect(videoDominantInRange(items, 0, 8)).toBe("left");
  });

  it("該当フレーム無しなら unknown", () => {
    const items = makeItems([[0, "left"]]);
    expect(videoDominantInRange(items, 20, 30)).toBe("unknown");
  });

  it("endSec は半開区間 (含まない)", () => {
    const items = makeItems([
      [4, "right"],
      [6, "left"],
    ]);
    // 範囲 [0, 6) は [4] だけ
    expect(videoDominantInRange(items, 0, 6)).toBe("right");
  });
});

describe("pickFrameTimestamps", () => {
  it("3 フレームが等間隔 (1/4, 2/4, 3/4 位置) で返る", () => {
    const stops = pickFrameTimestamps(0, 12);
    expect(stops).toEqual([3, 6, 9]);
  });

  it("count=1 なら中央 1 枚", () => {
    const stops = pickFrameTimestamps(10, 20, 1);
    expect(stops).toEqual([15]);
  });

  it("count=5 なら 1/6 単位", () => {
    const stops = pickFrameTimestamps(0, 6, 5);
    expect(stops).toEqual([1, 2, 3, 4, 5]);
  });

  it("duration<=0 なら空配列", () => {
    expect(pickFrameTimestamps(10, 10)).toEqual([]);
    expect(pickFrameTimestamps(10, 5)).toEqual([]);
  });

  it("count<=0 なら空配列", () => {
    expect(pickFrameTimestamps(0, 10, 0)).toEqual([]);
  });
});
