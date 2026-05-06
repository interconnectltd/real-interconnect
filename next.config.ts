import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Tree-shake で重いパッケージの barrel import を module-by-module 化
  // → 初期 chunk 30-50KB 削減
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@tanstack/react-query",
      "sonner",
      "@base-ui/react",
    ],
  },
  // 画像配信最適化 (Netlify Image CDN / next/image)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000, // 1年 (avatar variant は path 別なので衝突なし)
    deviceSizes: [375, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 384],
  },
  async rewrites() {
    return [
      {
        source: "/",
        destination: "/lp/index.html",
      },
    ];
  },
  // 流入取りこぼし対策: 業界標準 path (/signup /sign-up /sign_up) を /register へ寄せる
  async redirects() {
    return [
      { source: "/signup", destination: "/register", permanent: true },
      { source: "/sign-up", destination: "/register", permanent: true },
      { source: "/sign_up", destination: "/register", permanent: true },
      { source: "/signin", destination: "/login", permanent: true },
      { source: "/sign-in", destination: "/login", permanent: true },
    ];
  },
};

export default nextConfig;
