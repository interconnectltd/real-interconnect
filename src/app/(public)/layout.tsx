import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950">
      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/img/interconnect-logo-header.png"
              alt="INTER CONNECT"
              width={140}
              height={28}
              className="brightness-0 invert"
            />
          </Link>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/70 hover:text-white hover:bg-white/10"
              render={<Link href="/login" />}
            >
              ログイン
            </Button>
            <Button
              size="sm"
              className="bg-white text-black hover:bg-white/90"
              render={<Link href="/register" />}
            >
              はじめる
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-16">{children}</main>

      <footer className="border-t border-white/10 bg-zinc-950 py-8">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-white/40">
              &copy; {new Date().getFullYear()} INTER CONNECT
            </p>
            <nav className="flex gap-6 text-sm text-white/40">
              <Link href="/terms" className="hover:text-white/70">
                利用規約
              </Link>
              <Link href="/privacy" className="hover:text-white/70">
                プライバシーポリシー
              </Link>
              <Link href="/tokushoho" className="hover:text-white/70">
                特定商取引法
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
