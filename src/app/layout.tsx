import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SupabaseProvider } from "@/providers/supabase-provider";
import { QueryProvider } from "@/providers/query-provider";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`} suppressHydrationWarning>
      <head>
        {/* Supabase Storage への preconnect で avatar 画像 LCP を短縮 */}
        {SUPABASE_HOST && (
          <>
            <link rel="preconnect" href={`https://${SUPABASE_HOST}`} crossOrigin="" />
            <link rel="dns-prefetch" href={`https://${SUPABASE_HOST}`} />
          </>
        )}
        {/* prefers-color-scheme の初回判定のみ inline (FOUC 防止)、listener 登録は client component で */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(window.matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {/* Provider を root に配置: route group 横断時に QueryClient cache が維持される */}
        <SupabaseProvider>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}
