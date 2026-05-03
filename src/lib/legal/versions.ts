/**
 * Legal document versions.
 *
 * Format: YYYY-MM-DD[suffix]
 *   - YYYY-MM-DD: effective date of the published revision
 *   - suffix (optional): a/b/c... for multiple revisions on the same day
 *
 * When you change the content of any legal document:
 *   1. Bump the corresponding constant here (e.g. "2026-05-03b" → "2026-05-04")
 *   2. Add a new row to terms_versions (migration or manual SQL)
 *   3. Re-deploy. Existing users keep their old acceptance row; the system
 *      can later detect "user has not accepted the latest version" by joining
 *      user_terms_acceptances with the latest from terms_versions.
 */
export const TERMS_VERSION = "2026-05-03c";
export const PRIVACY_VERSION = "2026-05-03c";
export const TOKUSHOHO_VERSION = "2026-05-03c";

export const LEGAL_VERSIONS = {
  terms: TERMS_VERSION,
  privacy: PRIVACY_VERSION,
  tokushoho: TOKUSHOHO_VERSION,
} as const;

export type LegalDocKind = keyof typeof LEGAL_VERSIONS;
