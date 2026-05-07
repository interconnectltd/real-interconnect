import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/safe-redirect";

/**
 * GET /auth/callback
 *
 * Wave1 sec audit (2026-05-07):
 *   - x-forwarded-host fallback を撤去 (NEXT_PUBLIC_SITE_URL 単一情報源)
 *   - PKCE: code_verifier cookie 不在時は exchange を試行せず login へ
 *   - safeInternalPath で next= を whitelist 検証
 */

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? ""
).replace(/\/+$/, "");

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  // 本番では SITE_URL 必須。dev/preview のみ requestUrl.origin に fallback。
  const origin =
    SITE_URL ||
    (process.env.NODE_ENV !== "production" ? requestUrl.origin : "");

  if (!origin) {
    return NextResponse.json(
      { data: null, error: { code: "MISCONFIGURED", message: "NEXT_PUBLIC_SITE_URL 未設定" } },
      { status: 500 },
    );
  }

  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const safePath = safeInternalPath(next, "/dashboard");

  // PKCE flow: code_verifier cookie が無い段階で exchange を許可しない
  // (Supabase SSR の cookie 名は `sb-<projectRef>-auth-token-code-verifier`)
  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasVerifier = /(?:^|;\s*)sb-[^=]*-auth-token-code-verifier=/.test(
    cookieHeader,
  );

  if (code && hasVerifier) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safePath}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
