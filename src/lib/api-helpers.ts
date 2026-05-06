import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/errors";
import { checkGeneralRateLimit } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * CSRF guard: state-changing requests (POST/PUT/PATCH/DELETE) は Origin を検証。
 * Same-origin / 許可リスト外なら 403。
 *
 * R2 Sec/Arch レビュー指摘:「CSRF Origin/Referer 検証なし」(両者 -3 致命) の解消。
 */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAME_ORIGIN_HOSTS = new Set([
  "inter-connect.app",
  "www.inter-connect.app",
  "localhost",
]);

function ensureSameOrigin(request: Request): void {
  if (!STATE_CHANGING.has(request.method)) return;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  // Origin ヘッダ優先 (fetch/XHR は必ず付く)
  if (origin) {
    try {
      const u = new URL(origin);
      if (!SAME_ORIGIN_HOSTS.has(u.hostname)) {
        throw new ApiError(403, "FORBIDDEN", "Cross-origin request rejected");
      }
      return;
    } catch {
      throw new ApiError(403, "FORBIDDEN", "Invalid origin header");
    }
  }
  // Origin 無の form POST 等は Referer で fallback
  if (referer) {
    try {
      const u = new URL(referer);
      if (!SAME_ORIGIN_HOSTS.has(u.hostname)) {
        throw new ApiError(403, "FORBIDDEN", "Cross-origin request rejected");
      }
      return;
    } catch {
      // ignore
    }
  }
  // Origin / Referer どちらも無いのは怪しい (CSRF or programmatic) → 拒否
  throw new ApiError(403, "FORBIDDEN", "Origin header required");
}

export function json<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data, error: null }, { status });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function withAuth(request?: Request): Promise<{
  user: User;
  supabase: SupabaseClient<Database>;
}> {
  // CSRF guard for state-changing methods
  if (request) ensureSameOrigin(request);

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, "UNAUTHORIZED", "認証が必要です");
  }

  // General API rate limit: 60 req/min per user (in-memory fast path; DB fallback in route 側)
  const rl = checkGeneralRateLimit(user.id);
  if (!rl.allowed) {
    throw new ApiError(429, "RATE_LIMITED", "リクエストが多すぎます。しばらくしてから再試行してください");
  }

  return { user, supabase };
}

/**
 * DB-backed rate limit (Netlify multi-instance 分散対応)。
 * R2 レビュー指摘:「in-memory rate-limit は分散で N倍カウント」の解消。
 *
 * @param supabase service_role 不要 (function は SECURITY DEFINER)
 * @param bucket   "chat.message.post" 等の識別子
 * @param limit    閾値 (window 内 max リクエスト数)
 * @param windowSeconds  sliding window の長さ
 * @returns true=許可, false=超過
 */
export async function checkDbRateLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds = 60,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn("[rate-limit] db check failed, falling open:", error.message);
      return true; // fail-open (DB 障害でサービス全停止を避ける)
    }
    return data === true;
  } catch (err) {
    console.warn("[rate-limit] exception, falling open:", err);
    return true;
  }
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.code, error.message);
  }

  // PostgreSQL unique violation → 409 Conflict
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  ) {
    return jsonError(409, "CONFLICT", "既に存在するデータです");
  }

  console.error("Unhandled API error:", error);
  return jsonError(500, "INTERNAL_ERROR", "サーバーエラーが発生しました");
}
