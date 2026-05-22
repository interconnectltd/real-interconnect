import { describe, expect, it } from "vitest";

import {
  buildFullText,
  fillEndSec,
  fromTldvSegments,
  parseTranscriptText,
} from "./transcript";

describe("parseTranscriptText", () => {
  it("`<name> [MM:SS]: <text>` 形式を Segment に変換", () => {
    const raw = "田島康平 [02:48]: なるほど、人がそこに改善しないことによって";
    const segs = parseTranscriptText(raw);
    expect(segs).toEqual([
      {
        speaker: "田島康平",
        startSec: 2 * 60 + 48,
        text: "なるほど、人がそこに改善しないことによって",
      },
    ]);
  });

  it("複数行 + 空行混入を正しくパース", () => {
    const raw = [
      "田島康平 [00:10]: こんにちは",
      "",
      "",
      "connect inter [00:15]: よろしくお願いします",
      "",
    ].join("\n");
    const segs = parseTranscriptText(raw);
    expect(segs).toHaveLength(2);
    expect(segs[0].speaker).toBe("田島康平");
    expect(segs[0].startSec).toBe(10);
    expect(segs[1].speaker).toBe("connect inter");
    expect(segs[1].startSec).toBe(15);
  });

  it("形式違反の行はスキップする", () => {
    const raw = [
      "田島康平 [00:10]: こんにちは",
      "this is not a valid line",
      "connect inter [00:20]: yes",
    ].join("\n");
    const segs = parseTranscriptText(raw);
    expect(segs).toHaveLength(2);
  });

  it("空入力で空配列", () => {
    expect(parseTranscriptText("")).toEqual([]);
  });
});

describe("fromTldvSegments", () => {
  it("tldv API の segment を Segment に変換", () => {
    const segs = fromTldvSegments([
      { speaker: "田島康平", startTime: 12.5, endTime: 18.2, text: "abc" },
    ]);
    expect(segs[0]).toEqual({
      speaker: "田島康平",
      startSec: 12.5,
      endSec: 18.2,
      text: "abc",
    });
  });
});

describe("fillEndSec", () => {
  it("endSec を次セグメントの startSec で補う", () => {
    const segs = [
      { speaker: "a", startSec: 0, text: "x" },
      { speaker: "b", startSec: 10, text: "y" },
      { speaker: "a", startSec: 25, text: "z" },
    ];
    const filled = fillEndSec(segs, 100);
    expect(filled.map((s) => s.endSec)).toEqual([10, 25, 100]);
  });

  it("tldv 由来の endSec が既にあれば保持", () => {
    const segs = [
      { speaker: "a", startSec: 0, endSec: 8, text: "x" },
      { speaker: "b", startSec: 10, text: "y" },
    ];
    const filled = fillEndSec(segs, 100);
    expect(filled[0].endSec).toBe(8);
    expect(filled[1].endSec).toBe(100);
  });
});

describe("buildFullText", () => {
  it("`[speaker]: text` 改行 join で出力", () => {
    const segs = [
      { speaker: "田島", text: "こんにちは" },
      { speaker: "sara", text: "yes" },
    ];
    expect(buildFullText(segs)).toBe("[田島]: こんにちは\n[sara]: yes");
  });

  it("labelOverrides で個別にラベルを差し替えできる", () => {
    const segs = [
      { speaker: "田島", text: "a" },
      { speaker: "sara", text: "b" },
    ];
    const out = buildFullText(segs, ["sara", "田島"]);
    expect(out).toBe("[sara]: a\n[田島]: b");
  });
});
