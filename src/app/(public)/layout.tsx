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
            <Button variant="ghost" size="sm" render={<Link href="/login" />}>
              ログイン
            </Button>
            <Button size="sm" render={<Link href="/register" />}>
              はじめる
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border/50 py-8">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} INTER CONNECT
            </p>
            <nav className="flex gap-6 text-sm text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground">
                利用規約
              </Link>
              <Link href="/privacy" className="hover:text-foreground">
                プライバシーポリシー
              </Link>
              <Link href="/tokushoho" className="hover:text-foreground">
                特定商取引法
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
