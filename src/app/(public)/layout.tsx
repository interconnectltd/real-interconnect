import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col pb-safe">
      {/* Skip link (WCAG 2.4.1 Bypass Blocks) */}
      <a
        href="#main"
        className="sr-only z-[200] rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        本文へスキップ
      </a>
      <header className="border-b border-border/50 pt-safe pl-safe pr-safe">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/" aria-label="INTER CONNECT" className="flex items-center">
            <Image
              src="/interconnect-logo-header.png"
              alt="INTER CONNECT"
              width={723}
              height={139}
              priority
              className="h-7 w-auto sm:h-8"
            />
          </Link>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              ログイン
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              className="bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
              render={<Link href="/register" />}
            >
              はじめる
            </Button>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>

      <footer className="border-t border-border/50 py-6">
        <div className="mx-auto max-w-5xl px-4">
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <Link href="/" className="py-2 hover:text-foreground">トップ</Link>
            <Link href="/terms" className="py-2 hover:text-foreground">利用規約</Link>
            <Link href="/privacy" className="py-2 hover:text-foreground">プライバシー</Link>
            <Link href="/tokushoho" className="py-2 hover:text-foreground">特商法</Link>
            <Link href="/contact" className="py-2 hover:text-foreground">お問い合わせ</Link>
          </nav>
          <p className="mt-3 text-center text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} INTER CONNECT株式会社
          </p>
        </div>
      </footer>
    </div>
  );
}
