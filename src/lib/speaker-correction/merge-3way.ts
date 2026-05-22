// 3-way verdict (tldv + video + audio) の多数決ロジック。
// PoC の `6-merge-3way.ts` と `7-downstream-ab.ts` から純粋ロジック部分を抽出。
//
// 監査指摘事項を反映:
//   - audio confidence < AUDIO_CONFIDENCE_FLOOR は audio="unknown" に降格
//     ("tldv と audio の相関エラー" を防ぐ第一線)

/** 話者の正規化 ID。例: "tajima" / "sara"。 */
export type NormalizedSpeakerId = string;

/** 3 者の各判定。"unknown" は判定不能 / 未判定。 */
export interface SegmentJudgment {
  tldv: NormalizedSpeakerId | "unknown";
  video: NormalizedSpeakerId | "unknown";
  audio: NormalizedSpeakerId | "unknown";
  audioConfidence: number;
}

export type Verdict =
  | "all-agree" //   3 者一致 → tldv 正
  | "tldv-wrong" //  video+audio 一致して tldv と違う → tldv 誤
  | "video-wrong" // tldv+audio 一致して video と違う
  | "audio-wrong" // tldv+video 一致して audio と違う
  | "all-disagree" // 3 者三様
  | "with-unknown"; // どれかが unknown

export interface VerdictResult {
  verdict: Verdict;
  /** "ambiguous" = 確定不能 (3 者 disagree or unknown 多すぎ) */
  trueSpeaker: NormalizedSpeakerId | "ambiguous";
  /** video 単独補正 (PoC) が正しかったか。null = 判定不能。 */
  pocCorrect: boolean | null;
}

/**
 * audio confidence の床値。これを下回る audio 判定は信用しない。
 * 監査指摘: 「tldv と audio が同じ誤判定をする」相関エラーへの対処。
 */
export const AUDIO_CONFIDENCE_FLOOR = 0.6;

/**
 * 3 者の判定をマージして verdict と真の話者 (推定) を返す。
 *
 * audio confidence が床値を下回るときは audio を unknown に降格してから
 * 判定する (= 「自信なき audio に多数決で勝たれるリスク」を断つ)。
 */
export function judgeSegment(input: SegmentJudgment): VerdictResult {
  const tldv = input.tldv;
  const video = input.video;
  const audio = input.audioConfidence < AUDIO_CONFIDENCE_FLOOR ? "unknown" : input.audio;

  const hasUnknown = tldv === "unknown" || video === "unknown" || audio === "unknown";

  if (hasUnknown) {
    const known = [tldv, video, audio].filter((x): x is NormalizedSpeakerId => x !== "unknown");
    const first = known[0];
    if (known.length >= 2 && first !== undefined && first === known[1]) {
      return {
        verdict: "with-unknown",
        trueSpeaker: first,
        pocCorrect: video === first || video === "unknown",
      };
    }
    return { verdict: "with-unknown", trueSpeaker: "ambiguous", pocCorrect: null };
  }

  if (tldv === video && video === audio) {
    return { verdict: "all-agree", trueSpeaker: tldv, pocCorrect: true };
  }
  if (tldv === video) {
    return { verdict: "audio-wrong", trueSpeaker: tldv, pocCorrect: true };
  }
  if (tldv === audio) {
    return { verdict: "video-wrong", trueSpeaker: tldv, pocCorrect: false };
  }
  if (video === audio) {
    return { verdict: "tldv-wrong", trueSpeaker: video, pocCorrect: true };
  }
  return { verdict: "all-disagree", trueSpeaker: "ambiguous", pocCorrect: null };
}

/**
 * 「補正対象は verdict="tldv-wrong" のときだけ」という保守的な戦略で、
 * セグメントの最終ラベル (display 用の生名) を決定する。
 *
 * - tldv-wrong → trueSpeaker の display 名に置換
 * - それ以外 → tldv の生ラベル維持 (誤検出による過剰補正を防ぐ)
 */
export function decideCorrectedLabel(
  tldvLabelDisplay: string,
  verdict: Verdict,
  trueSpeaker: NormalizedSpeakerId | "ambiguous",
  idToDisplayName: Readonly<Record<string, string>>,
): string {
  if (verdict !== "tldv-wrong") return tldvLabelDisplay;
  if (trueSpeaker === "ambiguous") return tldvLabelDisplay;
  return idToDisplayName[trueSpeaker] ?? tldvLabelDisplay;
}

/**
 * verdict 件数の集計。`correction_meta` JSONB に保存する用。
 */
export function countVerdicts(results: ReadonlyArray<VerdictResult>): Record<Verdict, number> {
  const counts: Record<Verdict, number> = {
    "all-agree": 0,
    "tldv-wrong": 0,
    "video-wrong": 0,
    "audio-wrong": 0,
    "all-disagree": 0,
    "with-unknown": 0,
  };
  for (const r of results) counts[r.verdict]++;
  return counts;
}

/**
 * 補正全体の信頼度を 0.0-1.0 で算出。`correction_confidence` カラムに入れる。
 *
 * - all-agree / tldv-wrong: 1.0 (確信)
 * - video-wrong / audio-wrong: 0.7 (片側少数派)
 * - with-unknown (2/3 一致): 0.6
 * - with-unknown (ambiguous) / all-disagree: 0.3
 */
export function aggregateConfidence(results: ReadonlyArray<VerdictResult>): number {
  if (results.length === 0) return 0;
  const score = (r: VerdictResult): number => {
    switch (r.verdict) {
      case "all-agree":
      case "tldv-wrong":
        return 1.0;
      case "video-wrong":
      case "audio-wrong":
        return 0.7;
      case "with-unknown":
        return r.trueSpeaker === "ambiguous" ? 0.3 : 0.6;
      case "all-disagree":
        return 0.3;
    }
  };
  const sum = results.reduce((a, r) => a + score(r), 0);
  return sum / results.length;
}
