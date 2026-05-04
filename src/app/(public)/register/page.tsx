import type { Metadata } from "next";
import Image from "next/image";
import { RegisterForm } from "@/components/features/auth/register-form";
import {
  LinkedInLoginButton,
  FacebookLoginButton,
} from "@/components/features/auth/facebook-login-button";

export const metadata: Metadata = { title: "新規登録" };

export default function RegisterPage() {
  return (
    <div className="relative isolate flex min-h-[calc(100dvh-4rem)] items-start justify-center px-4 py-10 sm:py-14">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60%] bg-gradient-brand-soft opacity-80 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <div className="w-full max-w-[480px]">
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
            <p className="ds-eyebrow mt-6">Create account</p>
            <h1 className="ds-h1 mt-1 tracking-tight text-foreground">
              アカウント作成
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              経営層の出会いを、もっと確かなものに。
            </p>
          </div>

          {/* Social first — B2B LinkedIn 優先 */}
          <div className="mt-6 space-y-2.5">
            <LinkedInLoginButton label="LinkedInで登録" />
            <FacebookLoginButton label="Facebookで登録" />
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              メールアドレスで登録
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>

          <RegisterForm />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          すでにアカウントをお持ちの方は{" "}
          <a
            href="/login"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            ログイン
          </a>
        </p>
      </div>
    </div>
  );
}
