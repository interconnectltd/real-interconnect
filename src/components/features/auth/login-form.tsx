"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginInput } from "@/validations/auth";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(data: LoginInput) {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (authError) {
      setError("メールアドレスまたはパスワードが正しくありません");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <span>{error}</span>
            <p className="text-xs">
              <Link
                href="/forgot-password"
                className="font-medium text-destructive underline underline-offset-2 hover:opacity-80"
              >
                パスワードを再設定
              </Link>
              {" / "}
              <Link
                href="/register"
                className="font-medium text-destructive underline underline-offset-2 hover:opacity-80"
              >
                新規登録
              </Link>
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-[13px] font-medium text-foreground">
          メールアドレス
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          enterKeyHint="next"
          aria-invalid={Boolean(errors.email) || undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p id="email-error" className="text-xs text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-[13px] font-medium text-foreground">
            パスワード
          </Label>
          <Link
            href="/forgot-password"
            className="-my-2 inline-flex min-h-[44px] items-center text-xs font-medium text-accent underline-offset-4 hover:underline"
          >
            お忘れですか？
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          aria-invalid={Boolean(errors.password) || undefined}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        {errors.password && (
          <p id="password-error" className="text-xs text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ログイン中...
          </>
        ) : (
          "ログイン"
        )}
      </Button>
    </form>
  );
}
