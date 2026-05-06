import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/errors";
import { checkGeneralRateLimit, checkRateLimit } from "@/lib/rate-limit";
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
   *
   * R4 Sec 補足: chat 系で完全 skip すると burst (短秒間連投) 防御が消える。
   * → burstLimit を併用すること。
   */
  skipMemoryRl?: boolean;
  /**
   * 短期 burst 防御: per-second スパムを抑制 (例: { perSecond: 10 })。
   * skipMemoryRl=true と併用しても短期窓の throttle は残す。
   */
  burstLimit?: { perSecond: number };
};

export async function withAuth(
  request: Request,
  options: WithAuthOptions = {},
): Promise<{
  user: User;
  supabase: SupabaseClient<Database>;
}> {
  // CSRF guard for state-changing methods (request 必須化で全 route が Origin 検証を受ける)
  ensureSameOrigin(request);

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, "UNAUTHORIZED", "認証が必要です");
  }

  // General API rate limit (in-memory fast path)
  // chat 系は DB-backed limiter のみ使うため skip 可
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

  // Burst 防御 (短期窓): skipMemoryRl=true でも残せる
  if (options.burstLimit) {
    const burst = checkRateLimit(
      `burst:${user.id}`,
      options.burstLimit.perSecond,
      1000, // 1 秒窓
    );
    if (!burst.allowed) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "短時間にリクエストが集中しました。少し待ってください",
      );
    }
  }

  return { user, supabase };
}

/**
 * DB-backed rate limit (Netlify multi-instance 分散対応, sliding window)。
 *
 * R2: in-memory N倍カウント解消
 * R4 Sec: fail-open 三段重ね指摘 → strict=true で fail-closed 化可能
 *
 * @param supabase service_role 不要 (RPC は SECURITY DEFINER)
 * @param strict   true なら DB 障害時に false (拒否) を返す。chat 系は true 推奨。
 */
export async function checkDbRateLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds = 60,
  strict = false,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn(
        `[rate-limit] db check failed (strict=${strict}):`,
        error.message,
      );
      return !strict; // strict=true なら拒否、false なら fail-open
    }
    return data === true;
  } catch (err) {
    console.warn(`[rate-limit] exception (strict=${strict}):`, err);
    return !strict;
  }
}

/**
 * Idempotency-Key で送信される body の SHA-256 hex hash を計算。
 * R4 Sec: payload 差し替え検知用。
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(hashBuf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * withAdminAuth - admin 限定 API helper.
 *
 * - 既存 withAuth を内部呼び出し (CSRF / RL / 認証は継承)
 * - user_profiles.is_admin = true を強制チェック (403)
 * - requireReason: true なら **`?reason=...` query string** (5..500 chars) 必須化 (法務 R5 整合)
 *
 * 注意: reason は現状 query string 専用。POST/PATCH の body 経由 reason は未対応。
 *       将来の mutation で reason 必須化する場合は header 経由 (`X-Admin-Reason`) への
 *       移行を検討 (URL 履歴・Referer leak 回避)。
 *
 * 使用例:
 *   const { user, supabase, reason } = await withAdminAuth(request, { requireReason: true });
 */
export async function withAdminAuth(
  request: Request,
  options: WithAuthOptions & { requireReason?: boolean } = {},
): Promise<{
  user: User;
  supabase: SupabaseClient<Database>;
  reason: string | null;
}> {
  const { user, supabase } = await withAuth(request, options);

  // admin route は GET であっても副作用 (audit log) を伴うため CSRF guard を強制
  // (withAuth は state-changing method のみ Origin 検証するので、admin GET の view_user 等が抜ける)
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method)) {
    // ensureSameOrigin と同等のチェックを内部で再実行 (GET でも本物の admin だけ通す)
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (origin) {
      try {
        const u = new URL(origin);
        const allowed = new Set(
          (process.env.ALLOWED_ORIGIN_HOSTS ?? "")
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean),
        );
        const defaults = ["inter-connect.app", "www.inter-connect.app"];
        const hosts = allowed.size > 0 ? allowed : new Set(defaults);
        if (
          !hosts.has(u.hostname) &&
          !(process.env.NODE_ENV !== "production" &&
            (u.hostname === "localhost" || u.hostname === "127.0.0.1")) &&
          !((process.env.ALLOW_NETLIFY_PREVIEW ?? "").toLowerCase() === "true" &&
            u.hostname.endsWith(".netlify.app"))
        ) {
          throw new ApiError(403, "FORBIDDEN", "Cross-origin admin GET rejected");
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(403, "FORBIDDEN", "Invalid origin header");
      }
    } else if (!referer) {
      throw new ApiError(403, "FORBIDDEN", "Origin/Referer required for admin");
    }
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data?.is_admin) {
    throw new ApiError(403, "FORBIDDEN", "admin 権限が必要です");
  }

  let reason: string | null = null;
  if (options.requireReason) {
    // X-Admin-Reason ヘッダ専用 (URL 履歴 / Referer leak / Netlify access log への
    // PII 流出を完全回避するため query fallback は廃止)
    const headerReason = (request.headers.get("x-admin-reason") ?? "")
      .replace(/[\r\n\t\0]/g, " ")
      .trim();
    if (headerReason.length < 5 || headerReason.length > 500) {
      throw new ApiError(
        400,
        "REASON_REQUIRED",
        "個人情報を閲覧するには X-Admin-Reason ヘッダで理由 (5-500 字) を送信してください",
      );
    }
    reason = headerReason;
  }

  return { user, supabase, reason };
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
