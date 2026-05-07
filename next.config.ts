import type { NextConfig } from "next";

/**
 * セキュリティヘッダ運用方針 (2026-05-07 Wave1 audit):
 *   - 静的部分は next.config の async headers() に集約 (Netlify [[headers]] は LP 配下のみ残す)
 *   - 動的 nonce が必要な CSP は src/proxy.ts で per-request 注入し header に埋める
 *   - 本ファイルでは "nonce 不要 / 全 path 共通" の固定値ヘッダのみ。
 */

const SUPABASE_HOST =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "") ?? "";

const SUPABASE_HTTPS = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : "";
const SUPABASE_WSS = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : "";

// CSP は proxy.ts で nonce を差し込んだ後に Response header に書き込む。
// ここでは "fallback (proxy が動かない静的 asset 配信)" 用の禁止系のみ。
const COMMON_HEADERS = [
  // HSTS: 2 年 + preload (audit: hstspreload.org 申請を併せて行う)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",
      "browsing-topics=()",
      "payment=()",
      "usb=()",
      "accelerometer=()",
      "gyroscope=()",
      "magnetometer=()",
    ].join(", "),
  },
  // OAuth popup 系で window.opener を切るが、redirect flow を壊さない
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@tanstack/react-query",
      "sonner",
      "@base-ui/react",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
    deviceSizes: [375, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 384],
  },
  async rewrites() {
    return [{ source: "/", destination: "/lp/index.html" }];
  },
  async redirects() {
    return [
      { source: "/signup", destination: "/register", permanent: true },
      { source: "/sign-up", destination: "/register", permanent: true },
      { source: "/sign_up", destination: "/register", permanent: true },
      { source: "/signin", destination: "/login", permanent: true },
      { source: "/sign-in", destination: "/login", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: COMMON_HEADERS,
      },
      // 認証関連 path は Cache-Control no-store を強制 (back/forward でフォーム残留禁止)
      {
        source: "/(login|register|forgot-password|reset-password)",
        headers: [
          ...COMMON_HEADERS,
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      // Supabase 直送 URL も connect 許可リストに含める設計 (proxy.ts で動的 CSP)
    ];
  },
};

// SUPABASE_HTTPS / SUPABASE_WSS は src/proxy.ts 内で同様に算出 (こちらでは不要)
void SUPABASE_HTTPS;
void SUPABASE_WSS;

export default nextConfig;
