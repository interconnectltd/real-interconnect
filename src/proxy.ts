import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (旧 middleware)。
 *   1. Supabase session refresh + auth gate (updateSession)
 *   2. CSP nonce per-request 発行 → response header & request header (layout で参照)
 */

const SUPABASE_HOST =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "") ?? "";
const SUPABASE_HTTPS = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : "";
const SUPABASE_WSS = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : "";

function generateNonce(): string {
  // 16 byte = 128 bit 乱数を base64
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa は base64 だが server runtime にも存在
  return btoa(bin).replace(/=+$/g, "");
}

function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Next.js dev は eval を使う
    isProd ? null : "'unsafe-eval'",
    isProd ? null : "'unsafe-inline'",
  ]
    .filter(Boolean)
    .join(" ");

  const items: Array<string | null> = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${SUPABASE_HTTPS}`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' ${SUPABASE_HTTPS} ${SUPABASE_WSS} https://api.pwnedpasswords.com`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    isProd ? "upgrade-insecure-requests" : null,
  ];
  return items.filter((v): v is string => Boolean(v)).join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();

  // Supabase auth gate を先に通す (redirect される場合はそのまま返す)
  const sessionResponse = await updateSession(request);

  // updateSession が redirect を返した場合は header だけ載せて返す
  // (NextResponse.redirect / new NextResponse の status で識別)
  const status = sessionResponse.status;
  const isRedirect = status >= 300 && status < 400;

  const csp = buildCsp(nonce);
  sessionResponse.headers.set("Content-Security-Policy", csp);
  sessionResponse.headers.set("x-nonce", nonce);

  if (isRedirect) return sessionResponse;

  // request 側 headers にも nonce を載せて Server Component が参照可能にする
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);

  // updateSession が next() を返した場合に nonce 付き request で再構成
  const proxied = NextResponse.next({ request: { headers: reqHeaders } });
  // sessionResponse の cookie を proxied に転写
  sessionResponse.cookies.getAll().forEach((c) => {
    proxied.cookies.set(c.name, c.value, c);
  });
  // header 転写
  sessionResponse.headers.forEach((v, k) => {
    proxied.headers.set(k, v);
  });
  return proxied;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|lp/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
