import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
import { RegisterSentResend } from "@/components/features/auth/register-sent-resend";

export const metadata: Metadata = {
  title: "確認メールを送信しました",
  // 検索エンジンに登録 funnel の中間ページをインデックスさせない
  robots: { index: false, follow: false },
};

// 簡易 email 形式 check (server で過剰に厳密にせず、不正時は resend ボタン非表示)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function RegisterSentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email: rawEmail } = await searchParams;
  const email =
    rawEmail && EMAIL_RE.test(rawEmail) && rawEmail.length <= 254
      ? rawEmail.toLowerCase()
      : null;

  return (
    <div className="relative isolate min-h-[calc(100svh-4rem)] lg:grid lg:grid-cols-2">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60%] bg-gradient-brand-soft opacity-80 [mask-image:linear-gradient(to_bottom,black,transparent)] lg:hidden"
      />

      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-[color:color-mix(in_oklab,var(--accent)_4%,var(--background))] lg:block"
      >
        <Image
          src="/illustrations/auth-hero-register.png"
          alt=""
          fill
          sizes="50vw"
          className="object-cover object-center"
          priority
        />
      </aside>

      <div className="flex items-start justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-[480px]">
          <div className="rounded-lg border border-border bg-card px-6 py-8 shadow-lg sm:px-8 sm:py-10">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent-strong ring-1 ring-accent/30">
                <Mail className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="mt-4 text-xl font-semibold text-foreground">
                確認メールを送信しました
              </h1>
              {email ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  <span className="break-all font-medium text-foreground">{email}</span>{" "}
                  宛にメールを送信しました。
                  <br />
                  メール内のリンクをクリックして登録を完了してください。
                </p>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  ご登録いただいたメールアドレス宛にメールを送信しました。
                  <br />
                  メール内のリンクをクリックして登録を完了してください。
                </p>
              )}
            </div>

            <ul className="mt-6 space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
              <li>・メールが届かない場合は、迷惑メールフォルダもご確認ください。</li>
              <li>・リンクの有効期限は 24 時間です。</li>
              <li>・受信に数十秒かかる場合があります。</li>
            </ul>

            {email && (
              <div className="mt-6">
                <RegisterSentResend email={email} />
              </div>
            )}

            <div className="mt-8 flex flex-col gap-1 text-center text-sm">
              <Link
                href="/login"
                className="inline-flex min-h-[44px] items-center justify-center font-medium text-accent underline-offset-4 hover:underline"
              >
                ログイン画面へ
              </Link>
              <Link
                href="/register"
                className="inline-flex min-h-[44px] items-center justify-center text-muted-foreground underline-offset-4 hover:underline"
              >
                別のメールアドレスで登録する
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
