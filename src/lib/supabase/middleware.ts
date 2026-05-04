import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public paths that don't require auth
  const publicPaths = [
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
  ];

  // publicPaths は exact match のみ + 限定的な startsWith。
  // /api/v1/legal/ 全部 startsWith は危険なため exact match に制限。
  const isPublicPath =
    publicPaths.includes(pathname) ||
    pathname.startsWith("/api/v1/health") ||
    pathname === "/api/v1/invitation" ||
    pathname === "/api/v1/legal/accept" ||
    pathname.startsWith("/lp") ||
    pathname.startsWith("/api/v1/webhooks");

  // Redirect unauthenticated users to login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const originalPath = request.nextUrl.pathname + request.nextUrl.search;
    if (originalPath !== "/") {
      url.searchParams.set("redirect", originalPath);
    }
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Consent gate: prospect招待経由ユーザー (prospect_invite_at が設定されている) で、
  // user_terms_acceptances にレコードがない場合は /onboarding/consent 強制 + APIアクセスは403。
  // /api/v1/legal/* と / (LP) と /onboarding/* は consent gate前でも到達可能。
  const consentBypassPaths = [
    "/onboarding/consent",
    "/api/v1/legal/accept",
    "/api/v1/legal/reject",
    "/api/v1/health",
  ];
  const isConsentBypass = consentBypassPaths.some(
    (p) => pathname === p || pathname.startsWith(p),
  );

  if (user && !isPublicPath && !isConsentBypass) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("onboarding_step, prospect_invite_at")
      .eq("id", user.id)
      .maybeSingle();

    const isProspectInvite = Boolean(
      (profile as { prospect_invite_at?: string | null } | null)?.prospect_invite_at,
    );

    if (isProspectInvite) {
      const { count } = await supabase
        .from("user_terms_acceptances")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if ((count ?? 0) === 0) {
        // API ルートは 403 JSON、UI は redirect
        if (pathname.startsWith("/api/")) {
          return new NextResponse(
            JSON.stringify({
              data: null,
              error: {
                code: "CONSENT_REQUIRED",
                message: "規約・プライバシー・特商法・AI越境移転への同意が必要です",
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

    // 通常signUpユーザー向けonboarding step guard (API以外)
    if (
      !pathname.startsWith("/onboarding") &&
      !pathname.startsWith("/api/") &&
      profile &&
      (profile.onboarding_step ?? 0) < 3
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
