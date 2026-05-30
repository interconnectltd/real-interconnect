"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { ResetPasswordInput } from "@/validations/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function init() {
      // URL hash に access_token / refresh_token がある場合は明示的に setSession する。
      // @supabase/ssr の createBrowserClient は hash 自動検出 (detectSessionInUrl) が
      // 動かないケースがあるため、ここで自前で処理する。
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const search = typeof window !== "undefined" ? window.location.search : "";
      const hashParams = hash.length > 1 ? new URLSearchParams(hash.slice(1)) : null;
      const searchParams = search.length > 1 ? new URLSearchParams(search.slice(1)) : null;

      // エラーパターン: token 期限切れ・再使用・無効など
      const errorCode =
        hashParams?.get("error_code") ?? searchParams?.get("error_code") ?? null;
      const errorDesc =
        hashParams?.get("error_description") ??
        searchParams?.get("error_description") ??
        hashParams?.get("error") ??
        searchParams?.get("error") ??
        null;
      if (errorCode || errorDesc) {
        if (!cancelled) {
          if (/expired/i.test(errorCode ?? "") || /expired/i.test(errorDesc ?? "")) {
            setLinkError(
              "パスワードリセットリンクの有効期限が切れています。再度リセットを申請してください。",
            );
          } else if (/used|consumed/i.test(errorCode ?? "")) {
            setLinkError(
              "このリセットリンクは既に使用済みです。再度リセットを申請してください。",
            );
          } else {
            setLinkError(
              `リセットリンクが無効です: ${errorDesc ?? errorCode ?? "不明なエラー"}`,
            );
          }
          setHasSession(false);
        }
        // hash/query を URL から削除
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", window.location.pathname);
        }
        return;
      }

      // 正常パターン: access_token + refresh_token を setSession
      if (hashParams) {
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          // hash を URL から削除 (token を URL に残さない: 履歴 / 共有時の漏洩防止)
          if (typeof window !== "undefined") {
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search,
            );
          }
          if (setErr && !cancelled) {
            setLinkError(
              "セッションの確立に失敗しました。再度リセットを申請してください。",
            );
            setHasSession(false);
            return;
          }
        }
      }

      const { data } = await supabase.auth.getUser();
      if (!cancelled) setHasSession(!!data.user);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<ResetPasswordInput>();

  async function onSubmit(data: ResetPasswordInput) {
    if (data.password !== data.confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.updateUser({
      password: data.password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // 他端末の session を全削除 (セッション乗っ取り被害の二次拡大防止)
    // recovery 経由で password 変更後、攻撃者が別 device で残っていた session を奪う事を阻止。
    try {
      await supabase.auth.signOut({ scope: "others" } as { scope: "others" });
    } catch {
      // signOut(scope: "others") に未対応の SDK 版でも続行
    }

    router.push("/login?password_reset=true");
  }

  if (hasSession === null) {
    return null;
  }

  if (hasSession === false) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-sm text-destructive">
            {linkError ?? "パスワードリセットリンクが無効または期限切れです。"}
          </p>
          <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
            再度リセットを申請する
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">新しいパスワード</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            新しいパスワードを設定してください
          </p>
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">新しいパスワード</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              enterKeyHint="next"
              placeholder="8文字以上"
              {...register("password", {
                required: "パスワードを入力してください",
                minLength: { value: 8, message: "8文字以上で入力してください" },
              })}
            />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">パスワード確認</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              enterKeyHint="go"
              {...register("confirmPassword", { required: "パスワードを再入力してください" })}
            />
            {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "設定中..." : "パスワードを設定"}
          </Button>
        </form>
      </div>
    </div>
  );
}
