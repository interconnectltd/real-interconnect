/**
 * DB-backed anon rate limit (00050 migration: rate_limits + check_anon_rate_limit RPC)。
 *
 * Wave1 sec audit (2026-05-07):
 *   in-memory rate-limit (`Map`) は Netlify Functions の cold start / multi-instance で
 *   ほぼ無効化される。anon endpoint (invitation/contact/legal-accept 等) は本 helper 経由で
 *   atomic upsert ベースの fixed-window limiter を使う。
 *
 * 使い方:
 *   const ok = await enforceAnonRateLimit({
 *     bucket: "contact:ip", identifier: ip ?? "unknown", limit: 5, windowSec: 3600,
 *   });
 *   if (!ok) return jsonError(429, "RATE_LIMITED", "...");
 */

import { createServiceClient } from "@/lib/supabase/server";

export interface RateLimitArgs {
  bucket: string;
  identifier: string;
  limit: number;
  windowSec: number;
  /** true で DB 障害時に拒否 (fail-closed)、false なら許可 (fail-open)。 */
  strict?: boolean;
}

export async function enforceAnonRateLimit(
  args: RateLimitArgs,
): Promise<boolean> {
  const { bucket, identifier, limit, windowSec, strict = false } = args;
  if (!identifier || identifier === "unknown") {
    // identifier 不明時の処理:
    //   strict=true → fail-closed (拒否、IP 詐称対策で安全側に倒す)
    //   strict=false → fail-open (許可、UX 優先)
    return !strict;
  }
  try {
    const supabase = await createServiceClient();
    type LooseRpc = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: boolean | null; error: { message?: string } | null }>;
    };
    const { data, error } = await (supabase as unknown as LooseRpc).rpc(
      "check_anon_rate_limit",
      {
        p_bucket: bucket,
        p_identifier: identifier,
        p_limit: limit,
        p_window_seconds: windowSec,
      },
    );
    if (error) {
      console.warn(
        `[rate-limit-db] rpc failed bucket=${bucket} strict=${strict}:`,
        error.message,
      );
      return !strict;
    }
    return data === true;
  } catch (e) {
    console.warn(`[rate-limit-db] exception bucket=${bucket} strict=${strict}:`, e);
    return !strict;
  }
}
