import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/client-ip";
import { enforceAnonRateLimit } from "@/lib/rate-limit-db";
import { enforceMinimumDelay, nowMs } from "@/lib/timing";

/**
 * POST /api/v1/auth/resend-confirmation
 *
 * 設計方針:
 *   1. Anti-enumeration: メール存在/未存在に関わらず 常に 200 success を返す。
 *      Supabase auth.resend() 自体も未存在メールでは silent no-op になる仕様。
 *   2. Timing side-channel 対策: enforceMinimumDelay で response 時間を均一化。
 *   3. 多層 rate limit (IP / email-hash):
 *        IP    : 10/h (1ユーザーが複数アドレスを試行する濫用抑止)
 *        email : 3/h  (特定アドレスへのメール爆撃を抑止)
 *      identifier は SHA-256 で hash 化 (rate_limits テーブルへ生 email を残さない)。
 *   4. Body は Zod で厳格 validate (string でないものは即 400)。
 */

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

export async function POST(request: Request) {
  const startedAt = nowMs();
  try {
    const h = await headers();
    const ip = getClientIp(h);

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      // 400 は anti-enumeration のスコープ外 (body 形式不正は攻撃者にも自明)。
      // 200 と分離しても enumeration は成立しないため即 return。
      return jsonError(400, "BAD_REQUEST", "メールアドレス形式が不正です");
    }
    const { email } = parsed.data;
    const emailHash = hashEmail(email);

    // ── Rate limit (IP 軸 / email 軸を並列で評価)
    //    両方 OK で初めて送信。片方 NG なら 429。
    const [okIp, okEmail] = await Promise.all([
      enforceAnonRateLimit({
        bucket: "resend_confirmation:ip",
        identifier: ip ?? "unknown",
        limit: 10,
        windowSec: 3600,
        strict: true,
      }),
      enforceAnonRateLimit({
        bucket: "resend_confirmation:email",
        identifier: emailHash,
        limit: 3,
        windowSec: 3600,
        strict: false,
      }),
    ]);
    if (!okIp || !okEmail) {
      await enforceMinimumDelay(startedAt, 700, 300);
      return jsonError(
        429,
        "RATE_LIMITED",
        "再送回数が多すぎます。1 時間ほど経ってから再度お試しください。",
      );
    }

    // ── emailRedirectTo は SITE_URL 単一情報源 (auth/callback と同じ方針)。
    //    env 未設定時は request URL から origin を派生 (dev/preview 救済)。
    //    Supabase は dashboard の Site URL/Redirect URLs allowlist と一致を要求するため、
    //    本番では NEXT_PUBLIC_APP_URL を必ず allowlist 内に置くこと。
    const envOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    const reqOrigin = envOrigin || new URL(request.url).origin;
    const emailRedirectTo = `${reqOrigin}/login?confirmed=true`;

    // ── Supabase resend (anon client / cookie バインド)
    //    type: "signup" は未確認ユーザー向け。session 不要。
    //    未存在メールに対しては silent no-op (anti-enumeration 自動担保)。
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo },
    });

    // Supabase 側 SMTP rate limit (over_email_send_rate_limit) は 429 として返す。
    // その他のエラーも基本は 200 化 (anti-enumeration) するが、明白な 429 だけは
    // ユーザーに「待ってね」と伝える方が UX が良い。
    if (error) {
      const status = (error as { status?: number }).status ?? 0;
      if (status === 429) {
        await enforceMinimumDelay(startedAt, 700, 300);
        return jsonError(
          429,
          "UPSTREAM_RATE_LIMITED",
          "短時間に多くのメールが送信されました。少し経ってから再度お試しください。",
        );
      }
      // それ以外の error (400 系含む) は anti-enumeration の都合で 200 success と
      // 区別せず response 時間も合わせて返す。サーバー側 log だけ残す。
      console.warn("[resend-confirmation] supabase error", {
        status,
        code: (error as { code?: string }).code,
      });
    }

    await enforceMinimumDelay(startedAt, 700, 300);
    return json({ ok: true });
  } catch (e) {
    // 内部例外は 500 で返す (anti-enumeration スコープ外)
    return handleApiError(e);
  }
}
