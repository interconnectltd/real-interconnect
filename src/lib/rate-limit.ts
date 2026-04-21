/**
 * Simple in-memory rate limiter (suitable for <100 users).
 * Uses a Map to track request counts per identifier within a sliding window.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, 60_000);
  // Allow the process to exit without waiting for the interval
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref();
  }
}

/**
 * Check whether a request is allowed under the rate limit.
 *
 * @param identifier - Unique key (e.g. userId, IP address)
 * @param maxRequests - Maximum number of requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @returns { allowed, remaining, resetAt }
 */
export function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  ensureCleanup();

  const now = Date.now();
  const entry = store.get(identifier);

  // Window expired or first request — start fresh
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs;
    store.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  // Within window
  entry.count += 1;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/* ------------------------------------------------------------------ */
/*  Pre-configured limiters for common API categories                 */
/* ------------------------------------------------------------------ */

/** General API: 60 req/min per user */
export function checkGeneralRateLimit(userId: string) {
  return checkRateLimit(`general:${userId}`, 60, 60_000);
}

/** Auth endpoints: 10 req/min per IP */
export function checkAuthRateLimit(ip: string) {
  return checkRateLimit(`auth:${ip}`, 10, 60_000);
}

/** Matching compute: 5 req per 5 min per user */
export function checkMatchingRateLimit(userId: string) {
  return checkRateLimit(`matching:${userId}`, 5, 5 * 60_000);
}
