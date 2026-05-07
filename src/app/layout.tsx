import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SupabaseProvider } from "@/providers/supabase-provider";
import { QueryProvider } from "@/providers/query-provider";
import { WebVitalsReporter } from "@/components/observability/web-vitals";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  // 日本語 glyph を含めるため "latin" のみだと文字化け fallback。weight subset で軽量化
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const SUPABASE_HOST =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "") ?? "";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // input zoom 抑止 (input.tsx 16px 化と併用)
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0a1633",
  // Chrome/Edge: ソフトキーボード出現時に layout viewport をリサイズせず overlay にする
  // → fixed bottom 要素 (HelpDock FAB / chat-input) が keyboard で押し上げられない問題を回避。
  //   chat ページは visualViewport API で別途 height 補正する設計と整合。
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: {
    default: "INTERCONNECT",
    template: "%s | INTERCONNECT",
  },
  description:
    "ビジネスの出会いを、もっと確かなものに。AIが分析するプロフェッショナルマッチングプラットフォーム。",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/favicon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CSP nonce: src/proxy.ts が per-request で発行し x-nonce header に詰める
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html
      lang="ja"
      className={`${inter.variable} ${notoSansJP.variable}`}
      // color-scheme: light を明示して scrollbar / native picker / form 内蔵 UI も
      // OS dark に引っ張られず light で統一 (B2B 方針)。
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <head>
        {/* Supabase Storage への preconnect で avatar 画像 LCP を短縮 */}
        {SUPABASE_HOST && (
          <>
            <link rel="preconnect" href={`https://${SUPABASE_HOST}`} crossOrigin="" />
            <link rel="dns-prefetch" href={`https://${SUPABASE_HOST}`} />
          </>
        )}
        {/* light モード固定 (B2B SaaS は OS dark 設定に追従しない方針)。
            ユーザー報告「背景が黒くなる」事象 = 旧 prefers-color-scheme:dark 自動検出が原因のため撤廃。
            将来 dark mode toggle UI を実装する場合は localStorage 駆動で復活させる。 */}
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {/* Provider を root に配置: route group 横断時に QueryClient cache が維持される */}
        <SupabaseProvider>
          <QueryProvider>
            <WebVitalsReporter />
            {children}
            <Toaster />
          </QueryProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}
