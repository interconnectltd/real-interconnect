export function sanitizeReferrer(referrer: string | null): string {
  if (!referrer) return "—";
  try {
    const url = new URL(referrer);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return "—";
  }
}
