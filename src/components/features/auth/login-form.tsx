"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginInput } from "@/validations/auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { enforceMinimumDelay, nowMs } from "@/lib/timing";

interface LoginErrorState {
  message: string;
  /** "Email not confirmed" 時に確認メール再送ボタンを表示するか */
  showResend: boolean;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<LoginErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  // forwarded ref + react-hook-form ref を両立
  const emailRegister = register("email");

  async function onSubmit(data: LoginInput) {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const startedAt = nowMs();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (authError) {
      // タイミング side-channel での email enumeration 対策 (Wave1 audit)
      await enforceMinimumDelay(startedAt, 700, 300);
      const status = (authError as { status?: number }).status ?? 0;
      const msg = authError.message ?? "";
      // 文言を 401 / 429 / 500 / Email not confirmed で分岐
      let display: LoginErrorState;
      if (msg.toLowerCase().includes("email not confirmed")) {
        display = {
          message:
            "メール確認が完了していません。受信トレイの確認メールのリンクをクリックしてください。",
          showResend: true,
        };
      } else if (status === 429) {
        display = {
          message:
            "短時間にログインを繰り返しました。1 分ほどお待ちいただいてから再度お試しください。",
          showResend: false,
        };
      } else if (status >= 500) {
        display = {
          message:
            "サーバーで一時的なエラーが発生しています。少し時間をおいて再度お試しください。",
          showResend: false,
        };
      } else {
        // 401 含む既定 (user enumeration 防止のため一般メッセージ)
        display = {
          message: "メールアドレスまたはパスワードが正しくありません",
          showResend: false,
        };
      }
      setError(display);
      setLoading(false);
      // a11y: エラー後はメール入力にフォーカスを戻す
      requestAnimationFrame(() => emailRef.current?.focus());
      return;
    }

    // ?redirect=<path> があればそちらへ (open redirect / backslash bypass を safeInternalPath で遮断)
    const target = safeInternalPath(searchParams.get("redirect"), "/dashboard");
    // push が refresh の RSC 取得 race に潰される事故 (Next.js 16) を回避するため
    // 先に push してから refresh する。
    router.push(target);
    router.refresh();
  }

  async function handleResendConfirmation() {
    const email = getValues("email");
    if (!email) {
      toast.error("確認メールを再送するにはメールアドレスを入力してください");
      emailRef.current?.focus();
      return;
    }
    setResending(true);
    try {
      const supabase = createClient();
      const { error: resendErr } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendErr) throw resendErr;
      toast.success("確認メールを再送しました。受信トレイをご確認ください");
    } catch {
      toast.error("再送に失敗しました。しばらくしてから再度お試しください");
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="scroll-mt-20 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-2">
            <span>{error.message}</span>
            {/* 3 連 inline link を縦並び化 (Wave6 D / M-2: モバイル誤タップ防止 / 各 44px hit) */}
            <div className="flex flex-col gap-1">
              {error.showResend && (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resending}
                  className="inline-flex min-h-[44px] items-center text-left font-medium text-destructive underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                >
                  {resending ? "再送中..." : "確認メールを再送する"}
                </button>
              )}
              <Link
                href="/forgot-password"
                className="inline-flex min-h-[44px] items-center font-medium text-destructive underline underline-offset-2 hover:opacity-80"
              >
                パスワードを再設定
              </Link>
              <Link
                href="/register"
                className="inline-flex min-h-[44px] items-center font-medium text-destructive underline underline-offset-2 hover:opacity-80"
              >
                新規登録
              </Link>
            </div>
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
          {...emailRegister}
          ref={(el) => {
            emailRegister.ref(el);
            emailRef.current = el;
          }}
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

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ログイン中...
          </>
        ) : (
          "ログイン"
        )}
      </Button>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        ログインすることで{" "}
        <Link href="/terms" className="underline underline-offset-2">
          利用規約
        </Link>
        {" / "}
        <Link href="/privacy" className="underline underline-offset-2">
          プライバシーポリシー
        </Link>
        に同意したものとみなされます。
      </p>
    </form>
  );
}
