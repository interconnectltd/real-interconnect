"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { registerSchema, type RegisterInput } from "@/validations/auth";
import { INDUSTRIES } from "@/lib/constants";

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { agreeToTerms: false },
  });

  const agreeToTerms = watch("agreeToTerms");

  async function onSubmit(data: RegisterInput) {
    setLoading(true);
    setError(null);

    // 招待コード検証
    let invitationId: string | null = null;
    try {
      const res = await fetch("/api/v1/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.invitationCode }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error?.message ?? "招待コードが無効です");
        setLoading(false);
        return;
      }
      const result = await res.json();
      invitationId = result.data?.invitation_id ?? null;
    } catch {
      setError("招待コードの検証に失敗しました");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          company: data.company ?? "",
          position: data.position ?? "",
          industry: data.industry,
          bio: data.bio ?? "",
        },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Increment invitation use_count after successful signup
    if (invitationId) {
      await fetch("/api/v1/invitation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation_id: invitationId }),
      }).catch(() => {
        // Non-critical: don't block registration if increment fails
      });
    }

    router.push("/login?confirmed=true");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="invitation-code">招待コード *</Label>
        <Input
          id="invitation-code"
          placeholder="招待コードを入力"
          autoComplete="off"
          enterKeyHint="next"
          {...register("invitationCode")}
          className="uppercase tracking-wider"
        />
        {errors.invitationCode && (
          <p className="text-sm text-destructive">{errors.invitationCode.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">お名前 *</Label>
        <Input
          id="name"
          autoComplete="name"
          placeholder="山田 太郎"
          enterKeyHint="next"
          {...register("name")}
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="reg-email">メールアドレス *</Label>
        <Input
          id="reg-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          enterKeyHint="next"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="reg-password">パスワード *</Label>
        <Input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          placeholder="8文字以上"
          enterKeyHint="next"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company">会社名</Label>
          <Input id="company" autoComplete="organization" placeholder="株式会社○○" enterKeyHint="next" {...register("company")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="position">役職</Label>
          <Input id="position" autoComplete="organization-title" placeholder="エンジニア" enterKeyHint="go" {...register("position")} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="industry">業種 *</Label>
        <select
          id="industry"
          {...register("industry")}
          className="w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm"
        >
          <option value="">選択してください</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind} value={ind}>{ind}</option>
          ))}
        </select>
        {errors.industry && (
          <p className="text-sm text-destructive">{errors.industry.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">自己紹介</Label>
        <textarea
          id="bio"
          {...register("bio")}
          className="w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm"
          rows={3}
          placeholder="あなたの専門領域や関心事を教えてください（マッチング精度が向上します）"
        />
      </div>

      <div className="flex items-start gap-2 pt-2">
        <Checkbox
          id="terms"
          checked={agreeToTerms}
          onCheckedChange={(checked) => setValue("agreeToTerms", checked === true)}
        />
        <Label htmlFor="terms" className="text-sm leading-relaxed">
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
            利用規約
          </a>
          （AI分析を含むサービス利用規約）に同意します
        </Label>
      </div>
      {errors.agreeToTerms && (
        <p className="text-sm text-destructive">{errors.agreeToTerms.message}</p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "登録中..." : "アカウント作成"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        すでにアカウントをお持ちですか？{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          ログイン
        </Link>
      </p>
    </form>
  );
}
