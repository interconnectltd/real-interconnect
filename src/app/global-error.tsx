"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", padding: "1rem" }}>
        <div style={{ textAlign: "center", maxWidth: "400px" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "0.5rem" }}>エラーが発生しました</h1>
          <p style={{ color: "#666", marginBottom: "1rem" }}>申し訳ありません。予期しないエラーが発生しました。</p>
          <button
            onClick={reset}
            style={{ padding: "0.5rem 1.5rem", borderRadius: "0.375rem", border: "1px solid #ccc", cursor: "pointer", fontSize: "0.875rem" }}
          >
            再読み込み
          </button>
        </div>
      </body>
    </html>
  );
}
