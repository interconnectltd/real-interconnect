/**
 * Get the site URL, preferring the environment variable over window.location.origin.
 * This handles WebView/PWA environments where window.location.origin may be incorrect.
 */
export function getSiteUrl(): string {
  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}
