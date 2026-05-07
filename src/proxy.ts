import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

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

  // request 側 headers に nonce を載せ、updateSession に渡して Server Component
  // (layout.tsx の headers().get('x-nonce')) で読めるようにする。
  // 旧実装では proxy.ts 側で別の NextResponse.next() を作って後から cookie/header
  // を転写していたが、`Headers.forEach` が set-cookie をカンマ結合 1 文字列で
  // 返す仕様の都合で、`set('set-cookie', concat)` により Supabase の chunk cookie
  // (sb-<ref>-auth-token.0/.1) が破壊され browser に届かず → /login redirect ループ
  // → ユーザー視点で「ログインしても画面が変わらない」になっていた。
  // 修正: updateSession に request headers を渡し、その中で `NextResponse.next({ request })`
  // を 1 度だけ作る。proxy.ts ではそこに nonce/CSP の response header を足すだけにする。
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);

  // Supabase auth gate を通す (redirect の場合はそのまま返す)
  const sessionResponse = await updateSession(request, reqHeaders);

  // CSP / nonce を response header に注入 (redirect でも次画面で使われる)
  const csp = buildCsp(nonce);
  sessionResponse.headers.set("Content-Security-Policy", csp);
  sessionResponse.headers.set("x-nonce", nonce);

  return sessionResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|lp/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
