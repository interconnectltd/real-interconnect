import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase auth gate (proxy.ts から呼ばれる)。
 *
 * Wave1 sec audit (2026-05-07) で以下を強化:
 *   - cookie set 時に httpOnly/secure/sameSite を明示 (ライブラリ default に依存しない)
 *   - consent gate の startsWith bypass を `=== p || startsWith(p + "/")` に修正
 *   - prefix path bypass (例: /onboarding/consent.evil) を遮断
 */
export async function updateSession(
  request: NextRequest,
  /**
   * proxy.ts から request 側に注入したい header (例: x-nonce) を受け取る。
   * 省略時は request.headers をそのまま使う。
   * NextResponse.next({ request: { headers } }) で渡すと、Server Component の
   * `headers()` から参照できるようになる。
   */
  injectedRequestHeaders?: Headers,
) {
  const requestForResponse = injectedRequestHeaders
    ? { headers: injectedRequestHeaders }
    : undefined;
  let supabaseResponse = requestForResponse
    ? NextResponse.next({ request: requestForResponse })
    : NextResponse.next({ request });

  const isProd = process.env.NODE_ENV === "production";

  function hardenCookie(
    options: Parameters<typeof supabaseResponse.cookies.set>[2] | undefined,
  ): Parameters<typeof supabaseResponse.cookies.set>[2] {
    // 注意: @supabase/ssr の DEFAULT_COOKIE_OPTIONS は意図的に
    //   `httpOnly: false` を渡してくる (browser client が PKCE code-verifier を
    //   document.cookie 経由で読む必要があるため)。
    //   `??` は null/undefined のみ fallback するので false を尊重 = 強制しない。
    //   仮に強制すると PKCE / token refresh が壊れるためそうしてはならない。
    //   secure / sameSite は Supabase default が undefined なので確実に上書き可能。
    return {
      ...(options ?? {}),
      sameSite: options?.sameSite ?? "lax",
      httpOnly: options?.httpOnly ?? true,
      secure: options?.secure ?? isProd,
    };
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // 重要: token refresh で setAll が再実行された時、injectedRequestHeaders
          // (x-nonce など) を保持しないと layout.tsx 側で nonce が空になる。
          supabaseResponse = requestForResponse
            ? NextResponse.next({ request: requestForResponse })
            : NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, hardenCookie(options)),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public paths that don't require auth (exact match のみを基本とする)
  const publicPaths = new Set([
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/terms",
    "/privacy",
    "/tokushoho",
    "/contact",
    "/api/v1/health",
    "/api/v1/invitation",
    "/api/v1/legal/accept",
  ]);

  // /api/v1/health/* / /api/v1/webhooks/* / /lp/* は startsWith 許可
  const isPublicPath =
    publicPaths.has(pathname) ||
    pathname.startsWith("/api/v1/health/") ||
    pathname === "/api/v1/transcripts/webhook" ||
    pathname.startsWith("/lp/") ||
    pathname.startsWith("/api/v1/webhooks/") ||
    // ICS feed は token 認証で公開
    pathname.startsWith("/api/v1/calendar/feed/") ||
    // 紹介リンクのリダイレクト route (/r/<code>) は anon 到達可
    pathname.startsWith("/r/");

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const originalPath = request.nextUrl.pathname + request.nextUrl.search;
    if (originalPath !== "/") {
      url.searchParams.set("redirect", originalPath);
    }
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // consent gate の path 判定 (prefix bypass 修正)
  // 例: "/onboarding/consent" は許可、"/onboarding/consent.evil" は遮断
  const consentBypassPaths = [
    "/onboarding/consent",
    "/api/v1/legal/accept",
    "/api/v1/legal/reject",
    "/api/v1/health",
  ];
  const isConsentBypass = consentBypassPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (user && !isPublicPath && !isConsentBypass) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("onboarding_step, prospect_invite_at")
      .eq("id", user.id)
      .maybeSingle();

    const isProspectInvite = Boolean(
      (profile as { prospect_invite_at?: string | null } | null)
        ?.prospect_invite_at,
    );

    if (isProspectInvite) {
      const { count } = await supabase
        .from("user_terms_acceptances")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if ((count ?? 0) === 0) {
        if (pathname.startsWith("/api/")) {
          return new NextResponse(
            JSON.stringify({
              data: null,
              error: {
                code: "CONSENT_REQUIRED",
                message:
                  "規約・プライバシー・特商法・AI越境移転への同意が必要です",
              },
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding/consent";
        return NextResponse.redirect(url);
      }
    }

    // onboarding gate の除外パス:
    //  - /onboarding (本体)
    //  - /api/ (全 API、それぞれが個別に gate する設計)
    //  - /admin/* (admin 機能、admin 自身は onboarding を経ない運用前提)
    //  - /agency/* (代理店ダッシュボード、申請承認後は onboarding 完了前でも見られるべき)
    //  - /settings/* (申請ボタン等、onboarding 中でも触れたい設定がある)
    const skipOnboarding =
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/admin/") ||
      pathname.startsWith("/agency/") ||
      pathname === "/agency" ||
      pathname.startsWith("/settings");

    if (
      !skipOnboarding &&
      profile &&
      (profile.onboarding_step ?? 0) < 3
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  // === Auth bypass header pass-through (Phase 2A 高速化) ===
  // proxy.ts → updateSession で既に getUser() で検証済の user を route handler が
  // 再検証 (再度 getUser() で +97ms) するのを避けるため、内部 header に user.id /
  // email を載せて渡す。withAuth() がこれを読み取って fast-path を取る。
  //
  // セキュリティ:
  //   - proxy.ts の matcher は全 /api/* / 全 page route をカバー → updateSession は
  //     必ず通る = この block も必ず通る
  //   - 受信時に必ず .delete() で client 偽装値を破棄してから .set() し直す
  //   - 未認証パスでは .delete() のみ → withAuth 側で header 不在 = 401 になる
  //   - delete だけでなく、user 有無に関わらず必ず supabaseResponse を再生成して
  //     最終 headers を bake する (defense-in-depth: Next.js が初期 .next() 時点で
  //     headers を capture する実装の場合に古い client 値が漏れるのを防ぐ)
  if (injectedRequestHeaders) {
    injectedRequestHeaders.delete("x-internal-user-id");
    injectedRequestHeaders.delete("x-internal-user-email");
    if (user) {
      injectedRequestHeaders.set("x-internal-user-id", user.id);
      injectedRequestHeaders.set("x-internal-user-email", user.email ?? "");
    }
    // 常に再生成 (delete だけでも反映を確実にする)。
    // getUser() 中に setAll が cookie refresh していた場合に備え cookie 移植。
    const existingCookies = supabaseResponse.cookies.getAll();
    supabaseResponse = NextResponse.next({
      request: { headers: injectedRequestHeaders },
    });
    existingCookies.forEach((c) => {
      supabaseResponse.cookies.set(c);
    });
  }

  return supabaseResponse;
}
