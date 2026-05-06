/** Sanitize user input for use in PostgREST filter strings.
 *
 * 削除する文字: ( ) , . " ' \ : * + ? | & = % _ \r \n \t \0
 *   - ( ) , はフィルタ句区切り
 *   - " ' \ は文字列リテラル escape
 *   - : は cast / 演算子区切り
 *   - * + ? | は ts_query / regex 系
 *   - & = は AND/EQ 演算子
 *   - % _ は LIKE wildcards (DoS / 過剰マッチ)
 *   - \r \n \t \0 は header/log 注入
 */
export function sanitizeFilterValue(value: string): string {
  return value.replace(/[(),."'\\:*+?|&=%_\r\n\t\0]/g, "").trim().slice(0, 200);
}

/** ILIKE pattern 用に %/_/\\ をエスケープ (DoS 防止) */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Validate UUID format */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** ISO 8601 timestamp (PostgreSQL timestamptz 受付形式) を簡易検証 */
export function isValidIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(
    value,
  )) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
}
