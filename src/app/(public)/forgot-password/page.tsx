"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { ForgotPasswordInput } from "@/validations/auth";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordInput>();

  async function onSubmit(data: ForgotPasswordInput) {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">メールを送信しました</h1>
          <p className="text-sm text-muted-foreground">
            パスワードリセットのリンクをメールで送信しました。メールをご確認ください。
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
