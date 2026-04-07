/** Sanitize user input for use in PostgREST filter strings. */
export function sanitizeFilterValue(value: string): string {
  // Remove characters that could break PostgREST filter syntax
  return value.replace(/[(),."'\\]/g, "").trim();
}

/** Validate UUID format */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
