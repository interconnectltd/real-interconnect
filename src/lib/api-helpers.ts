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
 * R2 Sec/Arch:「CSRF Origin/Referer 検証なし」解消。
 * R3 Arch:「allowlist hardcode で preview branch 全 403 化」→ env 由来 + *.netlify.app ワイルドカード対応。
 *
 * 環境変数:
 *   ALLOWED_ORIGIN_HOSTS = "inter-connect.app,www.inter-connect.app"
 *     (カンマ区切り、未設定時はデフォルト本番 host)
 *   ALLOW_NETLIFY_PREVIEW = "true" で *.netlify.app を許可 (preview deploy 用)
 */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const DEFAULT_HOSTS = ["inter-connect.app", "www.inter-connect.app"];
const ENV_HOSTS = (process.env.ALLOWED_ORIGIN_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const SAME_ORIGIN_HOSTS = new Set(
  ENV_HOSTS.length > 0 ? ENV_HOSTS : DEFAULT_HOSTS,
);
const ALLOW_NETLIFY_PREVIEW =
  (process.env.ALLOW_NETLIFY_PREVIEW ?? "").toLowerCase() === "true";
const ALLOW_LOCALHOST = process.env.NODE_ENV !== "production";

function isAllowedHost(hostname: string): boolean {
  if (SAME_ORIGIN_HOSTS.has(hostname)) return true;
  if (ALLOW_LOCALHOST && (hostname === "localhost" || hostname === "127.0.0.1"))
    return true;
  if (ALLOW_NETLIFY_PREVIEW && hostname.endsWith(".netlify.app")) return true;
  return false;
}

function ensureSameOrigin(request: Request): void {
  if (!STATE_CHANGING.has(request.method)) return;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    try {
      const u = new URL(origin);
      if (!isAllowedHost(u.hostname)) {
        throw new ApiError(403, "FORBIDDEN", "Cross-origin request rejected");
      }
      return;
    } catch {
      throw new ApiError(403, "FORBIDDEN", "Invalid origin header");
    }
  }
  if (referer) {
    try {
      const u = new URL(referer);
      if (!isAllowedHost(u.hostname)) {
        throw new ApiError(403, "FORBIDDEN", "Cross-origin request rejected");
      }
      return;
    } catch {
      // ignore
    }
  }
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

export type WithAuthOptions = {
  /**
   * true 時に in-memory checkGeneralRateLimit を skip。
   * R3 Arch:「withAuth と DB rate-limit 二重評価で偽陽性 429」解消。
   * chat 系のように route 側で checkDbRateLimit を呼ぶ場合に true。
   */
  skipMemoryRl?: boolean;
};

export async function withAuth(
  request?: Request,
  options: WithAuthOptions = {},
): Promise<{
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

  // General API rate limit (in-memory fast path)
  // chat 系は DB-backed limiter のみ使うため skip
  if (!options.skipMemoryRl) {
    const rl = checkGeneralRateLimit(user.id);
    if (!rl.allowed) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "リクエストが多すぎます。しばらくしてから再試行してください",
      );
    }
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
