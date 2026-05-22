import { describe, expect, it } from "vitest";

import {
  AUDIO_CONFIDENCE_FLOOR,
  aggregateConfidence,
  countVerdicts,
  decideCorrectedLabel,
  judgeSegment,
  type VerdictResult,
} from "./merge-3way";

const HIGH_CONF = 0.95;
const LOW_CONF = 0.4;

describe("judgeSegment", () => {
  it("3 者一致 → all-agree, pocCorrect=true", () => {
    const r = judgeSegment({
      tldv: "sara",
      video: "sara",
      audio: "sara",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("all-agree");
    expect(r.trueSpeaker).toBe("sara");
    expect(r.pocCorrect).toBe(true);
  });

  it("video+audio 一致して tldv と違う → tldv-wrong", () => {
    const r = judgeSegment({
      tldv: "tajima",
      video: "sara",
      audio: "sara",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("tldv-wrong");
    expect(r.trueSpeaker).toBe("sara");
    expect(r.pocCorrect).toBe(true);
  });

  it("tldv+audio 一致して video と違う → video-wrong", () => {
    const r = judgeSegment({
      tldv: "sara",
      video: "tajima",
      audio: "sara",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("video-wrong");
    expect(r.trueSpeaker).toBe("sara");
    expect(r.pocCorrect).toBe(false);
  });

  it("tldv+video 一致して audio と違う → audio-wrong", () => {
    const r = judgeSegment({
      tldv: "sara",
      video: "sara",
      audio: "tajima",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("audio-wrong");
    expect(r.trueSpeaker).toBe("sara");
    expect(r.pocCorrect).toBe(true);
  });

  it("3 者バラバラ (a/b/c) → all-disagree, ambiguous", () => {
    const r = judgeSegment({
      tldv: "a",
      video: "b",
      audio: "c",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("all-disagree");
    expect(r.trueSpeaker).toBe("ambiguous");
    expect(r.pocCorrect).toBeNull();
  });

  it("audio confidence が床値未満なら audio=unknown 降格", () => {
    // tldv=sara, video=sara, audio=tajima だが audio 信頼度が低い
    // → audio が unknown 降格、tldv と video が 2/2 一致で with-unknown
    const r = judgeSegment({
      tldv: "sara",
      video: "sara",
      audio: "tajima",
      audioConfidence: LOW_CONF,
    });
    expect(r.verdict).toBe("with-unknown");
    expect(r.trueSpeaker).toBe("sara");
  });

  it("床値ちょうどなら audio を信用 (>= ではなく >)", () => {
    const r = judgeSegment({
      tldv: "sara",
      video: "sara",
      audio: "sara",
      audioConfidence: AUDIO_CONFIDENCE_FLOOR,
    });
    // 床値ちょうど = 信用する (`>= FLOOR` 採用) → all-agree
    expect(r.verdict).toBe("all-agree");
  });

  it("unknown が 1 つあり、残り 2 つ一致なら with-unknown で trueSpeaker 確定", () => {
    const r = judgeSegment({
      tldv: "unknown",
      video: "sara",
      audio: "sara",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("with-unknown");
    expect(r.trueSpeaker).toBe("sara");
  });

  it("unknown が 1 つあり、残り 2 つが食い違うなら ambiguous", () => {
    const r = judgeSegment({
      tldv: "unknown",
      video: "sara",
      audio: "tajima",
      audioConfidence: HIGH_CONF,
    });
    expect(r.verdict).toBe("with-unknown");
    expect(r.trueSpeaker).toBe("ambiguous");
  });
});

describe("decideCorrectedLabel", () => {
  const idToName = { sara: "connect inter", tajima: "田島康平" };

  it("tldv-wrong のときだけ trueSpeaker を採用", () => {
    expect(decideCorrectedLabel("田島康平", "tldv-wrong", "sara", idToName)).toBe(
      "connect inter",
    );
  });

  it("all-agree なら元ラベルを維持", () => {
    expect(decideCorrectedLabel("田島康平", "all-agree", "tajima", idToName)).toBe(
      "田島康平",
    );
  });

  it("video-wrong / audio-wrong / all-disagree でも補正しない", () => {
    expect(decideCorrectedLabel("田島康平", "video-wrong", "tajima", idToName)).toBe("田島康平");
    expect(decideCorrectedLabel("田島康平", "audio-wrong", "tajima", idToName)).toBe("田島康平");
    expect(decideCorrectedLabel("田島康平", "all-disagree", "ambiguous", idToName)).toBe("田島康平");
  });

  it("trueSpeaker=ambiguous なら補正しない", () => {
    expect(decideCorrectedLabel("田島康平", "tldv-wrong", "ambiguous", idToName)).toBe(
      "田島康平",
    );
  });

  it("id にマッピングが無ければ元ラベル維持 (安全側)", () => {
    expect(decideCorrectedLabel("田島康平", "tldv-wrong", "unknown_user", idToName)).toBe(
      "田島康平",
    );
  });
});

describe("countVerdicts", () => {
  it("verdict ごとの件数を集計", () => {
    const results: VerdictResult[] = [
      { verdict: "all-agree", trueSpeaker: "a", pocCorrect: true },
      { verdict: "all-agree", trueSpeaker: "b", pocCorrect: true },
      { verdict: "tldv-wrong", trueSpeaker: "c", pocCorrect: true },
      { verdict: "with-unknown", trueSpeaker: "ambiguous", pocCorrect: null },
    ];
    const counts = countVerdicts(results);
    expect(counts["all-agree"]).toBe(2);
    expect(counts["tldv-wrong"]).toBe(1);
    expect(counts["with-unknown"]).toBe(1);
    expect(counts["video-wrong"]).toBe(0);
  });
});

describe("aggregateConfidence", () => {
  it("all-agree のみなら 1.0", () => {
    const r: VerdictResult = { verdict: "all-agree", trueSpeaker: "a", pocCorrect: true };
    expect(aggregateConfidence([r, r, r])).toBe(1);
  });

  it("all-disagree のみなら 0.3", () => {
    const r: VerdictResult = { verdict: "all-disagree", trueSpeaker: "ambiguous", pocCorrect: null };
    expect(aggregateConfidence([r])).toBeCloseTo(0.3);
  });

  it("空配列なら 0", () => {
    expect(aggregateConfidence([])).toBe(0);
  });

  it("混在: all-agree(1.0) と video-wrong(0.7) の平均", () => {
    const a: VerdictResult = { verdict: "all-agree", trueSpeaker: "x", pocCorrect: true };
    const b: VerdictResult = { verdict: "video-wrong", trueSpeaker: "x", pocCorrect: false };
    expect(aggregateConfidence([a, b])).toBeCloseTo(0.85);
  });
});
