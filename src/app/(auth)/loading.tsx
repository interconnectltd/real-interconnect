/**
 * (auth) route group の universal loading skeleton。
 * クリック → 即この骨格が表示 → データ到着で実コンテンツに差し替え。
 *
 * 設計方針:
 *   - ヘッダー (eyebrow + h1 + subtitle) は全ページ共通構造
 *   - 中央セクション 1 個 + リストカード 4 個で「ほぼ全ページ違和感なし」を狙う
 *   - 既存パターン (h-32 / h-44 animate-pulse rounded-lg border border-border bg-card) と整合
 *   - 固定高さで CLS (Cumulative Layout Shift) ゼロを担保
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Header skeleton (eyebrow + title + subtitle) */}
      <div className="space-y-2">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="h-7 w-64 max-w-[60%] animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 max-w-[80%] animate-pulse rounded bg-muted/70" />
      </div>

      {/* Optional control row (filters / tabs / search) */}
      <div className="h-12 animate-pulse rounded-lg border border-border bg-card" />

      {/* Primary content list (cards) */}
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
