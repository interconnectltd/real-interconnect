// transcript セグメントの型と、テキスト形式 / tldv API 形式からの変換。
//
// PoC では `scripts/tldv-speaker-fix/{4,5,6,7}-*.ts` の 4 ファイルに同じ
// 正規表現の parseTranscript がコピペされていた。本ファイルに集約する。
//
// 本番経路では tldv API から `TldvTranscriptSegment[]` を受けるので、
// テキストパースより `fromTldvSegments` の方が正確 (endTime も持っている)。

export interface Segment {
  speaker: string;
  startSec: number;
  /**
   * セグメント終端秒。tldv API 経由で取得した場合は endTime が入る。
   * テキスト形式 (PoC) からパースした場合は `undefined`、呼び出し側が次セグメント
   * の startSec で補う必要がある。
   */
  endSec?: number;
  text: string;
}

/**
 * `"<speaker> [MM:SS]: <text>"` 形式の改行区切りテキストをパース。
 * PoC の transcript.txt 互換。
 */
export function parseTranscriptText(raw: string): Segment[] {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const segs: Segment[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\s+\[(\d{1,2}):(\d{2})\]:\s*(.*)$/);
    if (!m) continue;
    // 正規表現がマッチしたら group 1〜4 は必ず存在する (noUncheckedIndexedAccess 用に明示)
    const speaker = m[1] ?? "";
    const mm = m[2] ?? "0";
    const ss = m[3] ?? "0";
    const text = m[4] ?? "";
    segs.push({
      speaker: speaker.trim(),
      startSec: parseInt(mm, 10) * 60 + parseInt(ss, 10),
      text: text.trim(),
    });
  }
  return segs;
}

/** tldv API の `TldvTranscriptSegment[]` を内部 Segment[] に変換 */
export function fromTldvSegments(
  segments: ReadonlyArray<{
    speaker: string;
    text: string;
    startTime: number;
    endTime: number;
  }>,
): Segment[] {
  return segments.map((s) => ({
    speaker: s.speaker,
    startSec: s.startTime,
    endSec: s.endTime,
    text: s.text,
  }));
}

/**
 * Segment 配列の各要素に endSec を補う。次セグメントの startSec、
 * または `fallbackTailSec` (動画全長等) で末尾を埋める。tldv API 経由で
 * 既に endSec を持っている場合はそのまま保持。
 */
export function fillEndSec(segments: Segment[], fallbackTailSec: number): Segment[] {
  return segments.map((s, i) => ({
    ...s,
    endSec: s.endSec ?? segments[i + 1]?.startSec ?? fallbackTailSec,
  }));
}

/**
 * DB の `meeting_transcripts.full_text` と互換のフォーマット
 * (`[speaker]: text` を改行 join) で再構築する。補正後の
 * `corrected_full_text` を書き戻す際に使う。
 */
export function buildFullText(
  segments: ReadonlyArray<Pick<Segment, "speaker" | "text">>,
  labelOverrides?: ReadonlyArray<string>,
): string {
  return segments
    .map((s, i) => `[${labelOverrides?.[i] ?? s.speaker}]: ${s.text}`)
    .join("\n");
}
