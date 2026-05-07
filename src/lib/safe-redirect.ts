/**
 * 同一サイト path のみ許可する open-redirect 防御 util。
 *
 * Wave1 sec audit (2026-05-07) で判明した bypass パターンを全て遮断:
 *   - "//evil.com"      (protocol-relative)
 *   - "/\\evil.com"     (Chrome/Firefox はパスの \ を / 扱い)
 *   - "/%2f%2fevil.com" (URL encode protocol-relative)
 *   - "/%5cevil.com"    (URL encode backslash)
 *   - "javascript:..."  (script スキーム)
 *   - "/\x00path"       (制御文字注入)
 *
 * 判定方法:
 *   1. raw 入力に backslash / encoded backslash / encoded double-slash / 制御文字が
 *      含まれていれば即拒否
 *   2. dummy origin で URL parse → origin が dummy と異なれば外部 → 拒否
 *   3. parsed pathname が `//` で始まる場合は protocol-relative として拒否
 *
 * 第 1 ラウンドの正規表現 `[ -\\]` は 0x20-0x5C の **広範囲** を遮断しており
 * `/dashboard` などの正常 path も拒否する致命的なバグだった。第 2 ラウンドで修正。
 */
const DUMMY_ORIGIN = "https://internal.invalid";

// 制御文字 (0x00-0x1F) + DEL (0x7F) + バックスラッシュリテラル + encoded backslash + encoded //
// `\\\\` で正規表現中の `\` 1 文字を表現
const FORBIDDEN_RAW = /[\x00-\x1f\x7f\\]|%5[cC]|%2[fF]%2[fF]/;

export function safeInternalPath(
  input: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (typeof input !== "string" || input.length === 0) return fallback;
  if (input.length > 1024) return fallback;
  if (FORBIDDEN_RAW.test(input)) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//")) return fallback;
  try {
    const u = new URL(input, DUMMY_ORIGIN);
    if (u.origin !== DUMMY_ORIGIN) return fallback;
    if (!u.pathname.startsWith("/")) return fallback;
    // URL parser が backslash を `/` に正規化するケースを受けて再検査
    if (u.pathname.startsWith("//")) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
