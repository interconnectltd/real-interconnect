"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";
import type { ForgotPasswordInput } from "@/validations/auth";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  // user enumeration 対策: エラー詳細はサーバ側 console のみ、UI には常に
  // 汎用「該当があれば送信」メッセージで成功 (sent=true) として扱う。
  // OWASP ASVS V2.2.3 / 認証情報列挙攻撃の防止。

  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordInput>();

  async function onSubmit(data: ForgotPasswordInput) {
    setLoading(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/reset-password`,
    });
    if (resetError) {
      // 内部ログのみ。UI では成功時と同じ汎用メッセージを返す。
      console.warn("[forgot-password] reset failed:", resetError.message);
    }
    // 成功/失敗 (rate limit / 存在しない email) どちらでも sent=true で
    // 「該当があれば送信した」汎用メッセージに統一 (列挙防止)
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">処理を受け付けました</h1>
          <p className="text-sm text-muted-foreground">
            ご入力のメールアドレスが登録されている場合、パスワードリセット用のリンクを送信しました。受信箱をご確認ください。
            <br />
            <span className="text-xs">数分経ってもメールが届かない場合は迷惑メールフォルダもご確認ください。</span>
          </p>
          <Button variant="outline" render={<Link href="/login" />}>
            ログインに戻る
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">パスワードリセット</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            登録済みのメールアドレスを入力してください
          </p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              enterKeyHint="go"
              {...register("email", { required: "メールアドレスを入力してください" })}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "送信中..." : "リセットリンクを送信"}
          </Button>
        </form>
        <p className="text-center text-sm">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            ログインに戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
