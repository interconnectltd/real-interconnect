"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
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
      // a11y / UX: エラー alert を必ず viewport center に寄せ、エラー後はメール入力にフォーカス
      // (mobile キーボード残置で alert が画面外に行く事故を遮断 / Wave8 X 指摘)
      requestAnimationFrame(() => {
        document
          .querySelector('[role="alert"]')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        emailRef.current?.focus();
      });
      return;
    }

    // signInWithPassword の Promise resolve 直後では cookie 同期が完了していない場合がある。
    // 明示的に getSession() を待って sb-* cookie が browser に書き込まれた事を保証してから navigate。
    // (Wave8: 「ログイン押しても変わらない」事故 = cookie 未設定で middleware が /login redirect する root cause)
    try {
      await supabase.auth.getSession();
    } catch {
      // 失敗しても続行 (signInWithPassword 成功時点で cookie はほぼ確実に存在)
    }

    // ログインセッション記録 (IP/UA/Referer をサーバー側で取得)
    fetch("/api/v1/auth/login-event", { method: "POST" }).catch(() => {});

    // ?redirect=<path> があればそちらへ (open redirect / backslash bypass を safeInternalPath で遮断)
    const target = safeInternalPath(searchParams.get("redirect"), "/dashboard");
    // window.location.assign は full nav で cookie / RSC キャッシュをリセット → middleware が
    // 確実に新しい session で auth 判定する。router.push (client nav) では稀に古い RSC が残って
    // /dashboard を /login へ再 redirect させる事故が出るため full nav を選択。
    if (typeof window !== "undefined") {
      window.location.assign(target);
    } else {
      router.push(target);
    }
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
      // client 直叩き (anon supabase.auth.resend) は rate-limit 不在 + 文言ばらつき。
      // server route 経由に統一: IP 軸 10/h + email 軸 3/h で多層 limit + timing 防御 + 常に generic レスポンス。
      const res = await fetch("/api/v1/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        toast.error(
          "再送回数が多すぎます。1 時間ほど経ってから再度お試しください。",
        );
        return;
      }
      if (!res.ok) {
        toast.error("再送に失敗しました。しばらくしてから再度お試しください");
        return;
      }
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
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <Label htmlFor="password" className="text-[13px] font-medium text-foreground">
            パスワード
          </Label>
          <Link
            href="/forgot-password"
            className="inline-flex min-h-[44px] items-center px-1 text-xs font-medium text-accent underline underline-offset-4"
          >
            お忘れですか？
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            enterKeyHint="go"
            aria-invalid={Boolean(errors.password) || undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            className="pr-12"
            {...register("password")}
          />
          {/* 表示 toggle: 盲目タイピングで 429 lockout に陥る前に確認可能 */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
            aria-pressed={showPassword}
            className="absolute right-1 top-1/2 inline-flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
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

      <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-[11px] leading-relaxed text-muted-foreground">
        <span>ログインすることで</span>
        <Link
          href="/terms"
          className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-2"
        >
          利用規約
        </Link>
        <span>/</span>
        <Link
          href="/privacy"
          className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-2"
        >
          プライバシーポリシー
        </Link>
        <span>に同意したものとみなされます。</span>
      </p>
    </form>
  );
}
