import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { hashIp } from "@/lib/agency";

const CODE_PATTERN = /^[A-Za-z0-9]{4,20}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const base = new URL(request.url);

  if (!CODE_PATTERN.test(code)) {
    return NextResponse.redirect(new URL("/register", base), 302);
  }

  try {
    const supabase = await createServiceClient();
    const { data: links } = await supabase.rpc("lookup_referral_link", {
      p_code: code,
    });
    const link = links?.[0];
    if (!link || !link.is_active) {
      return NextResponse.redirect(new URL("/register", base), 302);
    }

    const cookieJar = request.headers.get("cookie") ?? "";
    const existingVisitor = parseCookie(cookieJar, "_ref_visitor");
    const visitorId = existingVisitor ?? crypto.randomUUID();

    const h = await headers();
    const ip =
      h.get("x-nf-client-connection-ip") ??
      h.get("cf-connecting-ip") ??
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const ua = h.get("user-agent");
    const referer = h.get("referer");

    // await 必須: fire-and-forget だと Next.js が response 送出後に process を
    // tear down して RPC が実行されないことがある (dev/serverless 両方)。
    const { error: rpcErr } = await supabase.rpc("record_referral_click", {
      p_link_id: link.id,
      p_visitor_id: visitorId,
      p_ip_hash: hashIp(ip),
      p_user_agent: ua,
      p_referrer: referer,
    });
    if (rpcErr) {
      console.warn("[r/[code]] record_referral_click failed:", rpcErr.message);
    }

    const res = NextResponse.redirect(
      new URL(`/register?ref=${encodeURIComponent(code)}`, base),
      302,
    );
    res.cookies.set("_ref_visitor", visitorId, {
      maxAge: 30 * 86400,
      sameSite: "lax",
      path: "/",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (e) {
    console.warn("[r/[code]] redirect-on-error:", e);
    return NextResponse.redirect(new URL("/register", base), 302);
  }
}

function parseCookie(raw: string, name: string): string | null {
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v ?? null;
  }
  return null;
}
