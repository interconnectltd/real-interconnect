import type { Metadata } from "next";
import { LoginForm } from "@/components/features/auth/login-form";
import { LinkedInLoginButton, FacebookLoginButton } from "@/components/features/auth/facebook-login-button";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">おかえりなさい</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            アカウントにログインしてください
          </p>
        </div>

        {params.confirmed === "true" && (
          <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
            確認メールを送信しました。メール内のリンクをクリックしてからログインしてください。
          </div>
        )}

        {params.error === "auth" && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            認証に失敗しました。もう一度お試しいただくか、メールアドレスでログインしてください。
          </div>
        )}

        <LoginForm />

        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              または
            </span>
          </div>
        </div>

        <LinkedInLoginButton />
        <FacebookLoginButton />
      </div>
    </div>
  );
}
