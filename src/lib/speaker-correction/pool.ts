// 簡易並列プール: concurrency 個ずつ並行で消化。
//
// PoC では `2-detect-speakers.ts` と `5-verify-voice.ts` に同じ実装が
// コピペされていた。本ファイルに集約。

/**
 * 配列 `items` の各要素に対し `worker` を最大 `concurrency` 並列で実行。
 * 入力順を保ったまま結果を返す。worker 内 throw は全体を reject させる。
 */
export async function runPool<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length;
  const results: R[] = new Array(total);
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= total) return;
        // i < total を確認済みなので items[i] は確実に存在する。
        // noUncheckedIndexedAccess 配慮で明示 cast。
        const item = items[i] as T;
        results[i] = await worker(item, i);
        done++;
        onProgress?.(done, total);
      }
    }),
  );
  return results;
}
