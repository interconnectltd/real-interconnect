import type { Metadata } from "next";
import { RegisterForm } from "@/components/features/auth/register-form";
import { LinkedInLoginButton, FacebookLoginButton } from "@/components/features/auth/facebook-login-button";

export const metadata: Metadata = { title: "新規登録" };

export default function RegisterPage() {
  return (
    <div className="flex items-start justify-center px-4 py-6 sm:py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">アカウント作成</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ビジネスの出会いを、もっと確かなものに
          </p>
        </div>

        <LinkedInLoginButton label="LinkedInで登録" />
        <FacebookLoginButton label="Facebookで登録" />

        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              メールアドレスで登録
            </span>
          </div>
        </div>

        <RegisterForm />
      </div>
    </div>
  );
}
