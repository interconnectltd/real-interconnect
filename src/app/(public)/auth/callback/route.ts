import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${requestUrl.protocol}//${request.headers.get('x-forwarded-host') || requestUrl.host}`;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  // Only allow relative paths to prevent open redirect
  const safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${safePath}`);
    }
  }

  // Auth error — redirect to login with error indication
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
