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
import { LegalDialog } from "@/components/legal/legal-dialog";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

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
    defaultValues: {
      agreeToTerms: false,
      agreeToPrivacy: false,
      agreeToTokushoho: false,
    },
  });

  const agreeToTerms = watch("agreeToTerms");
  const agreeToPrivacy = watch("agreeToPrivacy");
  const agreeToTokushoho = watch("agreeToTokushoho");

  async function onSubmit(data: RegisterInput) {
    setLoading(true);
    setError(null);

    console.group("[register] submit");
    console.log("[register] form data", {
      invitationCode: data.invitationCode,
      invitationCodeLen: data.invitationCode?.length,
      email: data.email,
      industry: data.industry,
      agreeToTerms: data.agreeToTerms,
      agreeToPrivacy: data.agreeToPrivacy,
      agreeToTokushoho: data.agreeToTokushoho,
    });

    // 招待コード検証
    let invitationId: string | null = null;
    try {
      console.log("[register] POST /api/v1/invitation", { code: data.invitationCode });
      const res = await fetch("/api/v1/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.invitationCode }),
      });
      console.log("[register] invitation response", { status: res.status, ok: res.ok });
      const bodyText = await res.text();
      console.log("[register] invitation body", bodyText);
      const parsed = bodyText ? JSON.parse(bodyText) : null;
      if (!res.ok) {
        const errMsg = parsed?.error?.message ?? "招待コードが無効です";
        console.error("[register] invitation failed", parsed);
        setError(errMsg);
        setLoading(false);
        console.groupEnd();
        return;
      }
      invitationId = parsed?.data?.invitation_id ?? null;
      console.log("[register] invitation OK", { invitationId });
    } catch (e) {
      console.error("[register] invitation fetch threw", e);
      setError("招待コードの検証に失敗しました");
      setLoading(false);
      console.groupEnd();
      return;
    }

    const supabase = createClient();
    const consentTimestamp = new Date().toISOString();
    console.log("[register] supabase.auth.signUp", { email: data.email });
    const { data: signUpData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          company: data.company ?? "",
          position: data.position ?? "",
          industry: data.industry,
          bio: data.bio ?? "",
          consent: {
            terms_version: LEGAL_VERSIONS.terms,
            privacy_version: LEGAL_VERSIONS.privacy,
            tokushoho_version: LEGAL_VERSIONS.tokushoho,
            accepted_at: consentTimestamp,
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          },
        },
      },
    });
    console.log("[register] signUp result", { user: signUpData?.user?.id ?? null, session: signUpData?.session ? "present" : "null", authError });

    if (authError) {
      console.error("[register] signUp error", authError);
      setError(authError.message);
      setLoading(false);
      console.groupEnd();
      return;
    }

    // Increment invitation use_count after successful signup
    if (invitationId) {
      console.log("[register] PATCH /api/v1/invitation", { invitationId });
      await fetch("/api/v1/invitation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation_id: invitationId }),
      }).catch((e) => {
        console.warn("[register] invitation PATCH failed (non-critical)", e);
      });
    }

    // Record consent for terms / privacy / tokushoho with IP+UA evidence.
    // Best-effort: don't block registration completion if logging fails.
    console.log("[register] POST /api/v1/legal/accept");
    await fetch("/api/v1/legal/accept", { method: "POST" }).catch((e) => {
      console.warn("[register] legal/accept failed (non-critical)", e);
    });

    console.log("[register] redirect to /login?confirmed=true");
    console.groupEnd();
    router.push("/login?confirmed=true");
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (validationErrors) => {
        console.warn("[register] zod validation blocked submit", validationErrors);
      })}
      className="space-y-4"
    >
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="invitation-code">招待コード *</Label>
        <Input
          id="invitation-code"
          placeholder="招待コードを入力 (例: TEST2026)"
          autoComplete="off"
          enterKeyHint="next"
          {...register("invitationCode")}
          className="tracking-wider"
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

      <fieldset className="space-y-3 rounded-md border border-border/60 p-3 pt-2">
        <legend className="px-1 text-sm font-medium">法務文書への同意（3点すべて必須）</legend>
        <p className="text-xs text-muted-foreground">
          下記リンクは全てモーダルで開きます。入力中のフォーム内容は失われません。
          内容を確認のうえ、それぞれにチェックを入れてください。
        </p>
        <LegalDialog
          trigger={
            <button
              type="button"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              3文書をまとめて読む（モーダルで開く）
            </button>
          }
        />

        <div className="flex items-start gap-2 pt-1">
          <Checkbox
            id="agree-terms"
            checked={agreeToTerms}
            onCheckedChange={(checked) => setValue("agreeToTerms", checked === true)}
          />
          <div className="text-sm leading-relaxed">
            <LegalDialog
              defaultTab="terms"
              trigger={
                <button type="button" className="text-primary underline-offset-4 hover:underline">
                  利用規約
                </button>
              }
            />
            （AI分析・米国への越境移転を含む）に
            <Label htmlFor="agree-terms" className="cursor-pointer">
              同意します
            </Label>
          </div>
        </div>
        {errors.agreeToTerms && (
          <p className="text-sm text-destructive">{errors.agreeToTerms.message}</p>
        )}

        <div className="flex items-start gap-2">
          <Checkbox
            id="agree-privacy"
            checked={agreeToPrivacy}
            onCheckedChange={(checked) => setValue("agreeToPrivacy", checked === true)}
          />
          <div className="text-sm leading-relaxed">
            <LegalDialog
              defaultTab="privacy"
              trigger={
                <button type="button" className="text-primary underline-offset-4 hover:underline">
                  プライバシーポリシー
                </button>
              }
            />
            （越境移転・委託先への提供を含む）に
            <Label htmlFor="agree-privacy" className="cursor-pointer">
              同意します
            </Label>
          </div>
        </div>
        {errors.agreeToPrivacy && (
          <p className="text-sm text-destructive">{errors.agreeToPrivacy.message}</p>
        )}

        <div className="flex items-start gap-2">
          <Checkbox
            id="agree-tokushoho"
            checked={agreeToTokushoho}
            onCheckedChange={(checked) => setValue("agreeToTokushoho", checked === true)}
          />
          <div className="text-sm leading-relaxed">
            <LegalDialog
              defaultTab="tokushoho"
              trigger={
                <button type="button" className="text-primary underline-offset-4 hover:underline">
                  特定商取引法に基づく表記
                </button>
              }
            />
            の内容を
            <Label htmlFor="agree-tokushoho" className="cursor-pointer">
              確認しました
            </Label>
          </div>
        </div>
        {errors.agreeToTokushoho && (
          <p className="text-sm text-destructive">{errors.agreeToTokushoho.message}</p>
        )}
      </fieldset>

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
