import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold text-primary">
            INTER CONNECT
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

      <main className="flex-1">{children}</main>

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
