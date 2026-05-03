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

  const isPublicPath = publicPaths.some(
    (p) => pathname === p || pathname.startsWith("/api/v1/health") || pathname.startsWith("/api/v1/invitation") || pathname.startsWith("/api/v1/legal/") || pathname.startsWith("/lp") || pathname.startsWith("/api/v1/webhooks"),
  );

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

  // Onboarding guard: redirect incomplete users to /onboarding
  // Skip for API routes, onboarding itself, and public paths
  if (
    user &&
    !isPublicPath &&
    !pathname.startsWith("/onboarding") &&
    !pathname.startsWith("/api/")
  ) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("onboarding_step")
      .eq("id", user.id)
      .maybeSingle();

    if (profile && (profile.onboarding_step ?? 0) < 3) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
