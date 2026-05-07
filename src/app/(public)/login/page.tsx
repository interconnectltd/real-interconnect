import type { Metadata } from "next";
import Image from "next/image";
import { CheckCircle2, Mail, AlertCircle } from "lucide-react";
import { LoginForm } from "@/components/features/auth/login-form";
import {
  LinkedInLoginButton,
  FacebookLoginButton,
} from "@/components/features/auth/facebook-login-button";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string; error?: string; password_reset?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="relative isolate min-h-[calc(100svh-4rem)] lg:grid lg:grid-cols-2">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60%] bg-gradient-brand-soft opacity-80 [mask-image:linear-gradient(to_bottom,black,transparent)] lg:hidden"
      />

      {/* 左 brand pane (lg+ のみ) — 縦長 portrait */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-[color:color-mix(in_oklab,var(--accent)_4%,var(--background))] lg:block"
      >
        <Image
          src="/illustrations/auth-hero-login.png"
          alt=""
          fill
          sizes="50vw"
          className="object-cover object-center"
          priority
        />
      </aside>

      {/* 右 form pane:
          - mobile は items-start で keyboard 表示時 form が viewport center に
            飛んで Submit が画面外に行く事を防ぐ
          - py-6 で alert 表示時の縦圧迫も最小化 */}
      <div className="flex items-start justify-center px-4 py-6 lg:items-center sm:py-16">
        <div className="w-full max-w-[420px]">
        <div className="rounded-lg border border-border bg-card px-6 py-8 shadow-lg sm:px-8 sm:py-10">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/interconnect-logo-header.png"
              alt="INTER CONNECT"
              width={723}
              height={139}
              priority
              className="h-7 w-auto"
            />
            <p className="ds-eyebrow mt-6">Welcome back</p>
            <h1 className="ds-h1 mt-1 tracking-tight text-foreground">
              おかえりなさい
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              経営層の出会いを、もっと確かなものに。
            </p>
          </div>

          {params.password_reset === "true" && (
            <div
              role="status"
              className="mt-6 flex items-start gap-2.5 rounded-lg border border-[color:color-mix(in_oklab,var(--success)_30%,var(--border))] bg-[color:color-mix(in_oklab,var(--success)_10%,var(--card))] px-3.5 py-3 text-sm text-[color:color-mix(in_oklab,var(--success)_85%,var(--foreground))]"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>パスワードを変更しました。新しいパスワードでログインしてください。</span>
            </div>
          )}

          {params.confirmed === "true" && (
            <div
              role="status"
              className="mt-6 flex items-start gap-2.5 rounded-lg border border-[color:color-mix(in_oklab,var(--accent)_30%,var(--border))] bg-[color:color-mix(in_oklab,var(--accent)_10%,var(--card))] px-3.5 py-3 text-sm text-[color:color-mix(in_oklab,var(--accent)_85%,var(--foreground))]"
            >
              <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>確認メールを送信しました。メール内のリンクをクリックしてからログインしてください。</span>
            </div>
          )}

          {params.error === "auth" && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>認証に失敗しました。もう一度お試しいただくか、メールアドレスでログインしてください。</span>
            </div>
          )}

          {/* Social first — B2B LinkedIn 優先 */}
          <div className="mt-6 space-y-2.5">
            <LinkedInLoginButton />
            <FacebookLoginButton />
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              または
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>

          <LoginForm />
        </div>

        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1 text-center text-sm text-muted-foreground">
          <span>アカウントをお持ちでない方は</span>
          <a
            href="/register"
            className="inline-flex min-h-[44px] items-center px-2 font-medium text-accent underline underline-offset-4"
          >
            新規登録
          </a>
        </p>
        </div>
      </div>
    </div>
  );
}
