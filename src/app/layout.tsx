import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "INTERCONNECT",
    template: "%s | INTERCONNECT",
  },
  description:
    "ビジネスの出会いを、もっと確かなものに。AIが分析するプロフェッショナルマッチングプラットフォーム。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var m=window.matchMedia('(prefers-color-scheme:dark)');if(m.matches)document.documentElement.classList.add('dark');m.addEventListener('change',function(e){document.documentElement.classList.toggle('dark',e.matches)})}catch(e){}` }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
