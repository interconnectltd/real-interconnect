"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { registerSchema, type RegisterInput } from "@/validations/auth";
import { INDUSTRIES } from "@/lib/constants";
import { LegalDialog } from "@/components/legal/legal-dialog";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

const labelClass = "text-[13px] font-medium text-foreground";
const fieldHelpClass = "text-xs text-destructive";
const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card pl-3 pr-10 py-2 text-base sm:text-sm transition-[box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 appearance-none";
const textareaClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm transition-[box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70";

// dev のみ console 出力 (本番ビルドで PII 漏出を防ぐ)
const isDev = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
const log = {
  group: (label: string) => isDev && console.group(label),
  groupEnd: () => isDev && console.groupEnd(),
  info: (...a: unknown[]) => isDev && console.log(...a),
  warn: (...a: unknown[]) => isDev && console.warn(...a),
  error: (...a: unknown[]) => isDev && console.error(...a),
};

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const errorRef = useRef<HTMLDivElement | null>(null);

  // form内 focus イベントから現在 active Step を割り出す
  function handleFocus(e: React.FocusEvent<HTMLFormElement>) {
    const stepEl = (e.target as HTMLElement).closest("[data-step]") as HTMLElement | null;
    if (!stepEl) return;
    const n = Number(stepEl.dataset.step);
    if (n === 1 || n === 2 || n === 3 || n === 4) setActiveStep(n);
  }

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

  // エラー表示時にスクロールしてフォーカス (長いフォーム対策)
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      errorRef.current.focus();
    }
  }, [error]);

  const agreeToTerms = watch("agreeToTerms");
  const agreeToPrivacy = watch("agreeToPrivacy");
  const agreeToTokushoho = watch("agreeToTokushoho");

  async function onSubmit(data: RegisterInput) {
    setLoading(true);
    setError(null);

    log.group("[register] submit");
    // PII (email / invitationCode) は本番ログに残さない (長さのみ)
    log.info("[register] form data", {
      invitationCodeLen: data.invitationCode?.length,
      emailLen: data.email?.length,
      industry: data.industry,
      agreeToTerms: data.agreeToTerms,
      agreeToPrivacy: data.agreeToPrivacy,
      agreeToTokushoho: data.agreeToTokushoho,
    });

    let invitationId: string | null = null;
    try {
      log.info("[register] POST /api/v1/invitation");
      const res = await fetch("/api/v1/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.invitationCode }),
      });
      log.info("[register] invitation response", { status: res.status, ok: res.ok });
      const bodyText = await res.text();
      const parsed = bodyText ? JSON.parse(bodyText) : null;
      if (!res.ok) {
        const errMsg = parsed?.error?.message ?? "招待コードが無効です";
        log.error("[register] invitation failed", parsed);
        setError(errMsg);
        setLoading(false);
        log.groupEnd();
        return;
      }
      invitationId = parsed?.data?.invitation_id ?? null;
      log.info("[register] invitation OK", { invitationId });
    } catch (e) {
      log.error("[register] invitation fetch threw", e);
      setError("招待コードの検証に失敗しました");
      setLoading(false);
      log.groupEnd();
      return;
    }

    const supabase = createClient();
    const consentTimestamp = new Date().toISOString();
    // PII (email) は本番ログに残さない
    log.info("[register] supabase.auth.signUp");
    const { data: signUpData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      // 確認メールから戻る先を明示 (フィッシング対策で Supabase Site URL 任せにしない)
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/login?confirmed=true`
            : undefined,
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
    log.info("[register] signUp result", {
      hasUser: signUpData?.user != null,
      session: signUpData?.session ? "present" : "null",
    });

    if (authError) {
      log.error("[register] signUp error", { code: (authError as { code?: string }).code });
      // Supabase エラーコード分岐: enumeration 防止 + 動線提供
      const status = (authError as { status?: number }).status ?? 0;
      const msg = authError.message ?? "";
      let display: string;
      if (msg.toLowerCase().includes("user already registered") || status === 422) {
        display =
          "このメールアドレスは既に登録されています。ログイン画面からお進みください。";
      } else if (msg.toLowerCase().includes("weak password") || msg.toLowerCase().includes("password")) {
        display =
          "パスワードが要件を満たしていません。8 文字以上で英数字を含めてください。";
      } else if (status === 429) {
        display =
          "短時間に多くのリクエストが発生しました。しばらく待ってから再度お試しください。";
      } else if (status >= 500) {
        display =
          "サーバーで一時的なエラーが発生しています。しばらく待ってから再度お試しください。";
      } else {
        display = "登録に失敗しました。入力内容を確認してください。";
      }
      setError(display);
      setLoading(false);
      log.groupEnd();
      return;
    }

    if (invitationId) {
      log.info("[register] PATCH /api/v1/invitation", { invitationId });
      await fetch("/api/v1/invitation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation_id: invitationId }),
      }).catch((e) => {
        log.warn("[register] invitation PATCH failed (non-critical)", e);
      });
    }

    log.info("[register] POST /api/v1/legal/accept");
    // body 必須化 (法的証跡偽装防止 / Sec audit 2026-05-07)
    await fetch("/api/v1/legal/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        terms: true,
        privacy: true,
        tokushoho: true,
        ai_cross_border: true,
      }),
    }).catch((e) => {
      log.warn("[register] legal/accept failed (non-critical)", e);
    });

    log.info("[register] redirect to /login?confirmed=true");
    log.groupEnd();
    router.push("/login?confirmed=true");
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (validationErrors) => {
        log.warn("[register] zod validation blocked submit", {
          fields: Object.keys(validationErrors),
        });
        // 最初のエラーフィールドにフォーカス (a11y / UX)
        const firstKey = Object.keys(validationErrors)[0];
        if (firstKey) {
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>(
              `[name="${firstKey}"]`,
            );
            el?.focus({ preventScroll: false });
          });
        }
      })}
      onFocusCapture={handleFocus}
      className="space-y-5"
      noValidate
    >
      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/30"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Step progress overview (UX P0: 全体感 + 動的active) */}
      <StepProgress activeStep={activeStep} />

      <Step
        number={1}
        title="招待コード"
        caption="ご紹介者から受け取ったコードを入力してください"
        isLast={false}
      >
        <div className="space-y-1.5">
          <Label htmlFor="invitation-code" className={labelClass}>
            招待コード <RequiredMark />
          </Label>
          <Input
            id="invitation-code"
            placeholder="例: TEST2026"
            autoComplete="off"
            enterKeyHint="next"
            aria-invalid={Boolean(errors.invitationCode) || undefined}
            aria-describedby={errors.invitationCode ? "invitation-code-error" : "invitation-code-hint"}
            {...register("invitationCode")}
            className="tracking-wider"
          />
          {errors.invitationCode ? (
            <p id="invitation-code-error" className={fieldHelpClass}>
              {errors.invitationCode.message}
            </p>
          ) : (
            <p id="invitation-code-hint" className="text-xs text-muted-foreground">
              招待コードをお持ちでない方は{" "}
              <Link
                href="/contact"
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                お問い合わせ
              </Link>
              からご連絡ください。
            </p>
          )}
        </div>
      </Step>

      <Step number={2} title="アカウント情報" isLast={false}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className={labelClass}>
              お名前 <RequiredMark />
            </Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder="山田 太郎"
              enterKeyHint="next"
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              {...register("name")}
            />
            {errors.name && (
              <p id="name-error" className={fieldHelpClass}>
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-email" className={labelClass}>
              メールアドレス <RequiredMark />
            </Label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              enterKeyHint="next"
              aria-invalid={Boolean(errors.email) || undefined}
              aria-describedby={errors.email ? "reg-email-error" : undefined}
              {...register("email")}
            />
            {errors.email && (
              <p id="reg-email-error" className={fieldHelpClass}>
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-password" className={labelClass}>
              パスワード <RequiredMark />
            </Label>
            <Input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              placeholder="8文字以上"
              enterKeyHint="next"
              aria-invalid={Boolean(errors.password) || undefined}
              aria-describedby={errors.password ? "reg-password-error" : undefined}
              {...register("password")}
            />
            {errors.password && (
              <p id="reg-password-error" className={fieldHelpClass}>
                {errors.password.message}
              </p>
            )}
          </div>
        </div>
      </Step>

      <Step number={3} title="プロフィール" caption="マッチング精度の向上にお使いします" isLast={false}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company" className={labelClass}>
                会社名 <OptionalMark />
              </Label>
              <Input
                id="company"
                autoComplete="organization"
                placeholder="株式会社○○"
                enterKeyHint="next"
                {...register("company")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="position" className={labelClass}>
                役職 <OptionalMark />
              </Label>
              <Input
                id="position"
                autoComplete="organization-title"
                placeholder="代表取締役"
                enterKeyHint="next"
                {...register("position")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="industry" className={labelClass}>
              業種 <RequiredMark />
            </Label>
            <div className="relative">
              <select
                id="industry"
                {...register("industry")}
                aria-invalid={Boolean(errors.industry) || undefined}
                aria-describedby={errors.industry ? "industry-error" : undefined}
                className={selectClass}
              >
                <option value="">選択してください</option>
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            {errors.industry && (
              <p id="industry-error" className={fieldHelpClass}>
                {errors.industry.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio" className={labelClass}>
              自己紹介 <OptionalMark />
            </Label>
            <textarea
              id="bio"
              {...register("bio")}
              className={textareaClass}
              rows={3}
              placeholder="あなたの専門領域や関心事を教えてください（マッチング精度が向上します）"
            />
          </div>
        </div>
      </Step>

      <Step
        number={4}
        title="法務文書への同意"
        caption="3点すべてのご確認・ご同意が必要です"
        accentIcon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
        isLast
      >
        <fieldset className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
          <legend className="sr-only">法務文書への同意</legend>
          <p className="text-xs leading-relaxed text-muted-foreground">
            下記リンクは全てモーダルで開きます。入力中のフォーム内容は失われません。
          </p>
          <LegalDialog
            trigger={
              <button
                type="button"
                className="inline-flex min-h-[28px] items-center text-xs font-medium text-accent underline-offset-4 hover:underline"
              >
                3文書をまとめて読む（モーダル）
              </button>
            }
          />

          <ConsentRow
            id="agree-terms"
            checked={agreeToTerms}
            onChange={(v) => setValue("agreeToTerms", v, { shouldValidate: true })}
            error={errors.agreeToTerms?.message}
          >
            <LegalDialog
              defaultTab="terms"
              trigger={
                <button type="button" className="font-medium text-accent underline-offset-4 hover:underline">
                  利用規約
                </button>
              }
            />
            （AI分析・米国への越境移転を含む）に
            <Label htmlFor="agree-terms" className="cursor-pointer font-medium">
              同意します
            </Label>
          </ConsentRow>

          <ConsentRow
            id="agree-privacy"
            checked={agreeToPrivacy}
            onChange={(v) => setValue("agreeToPrivacy", v, { shouldValidate: true })}
            error={errors.agreeToPrivacy?.message}
          >
            <LegalDialog
              defaultTab="privacy"
              trigger={
                <button type="button" className="font-medium text-accent underline-offset-4 hover:underline">
                  プライバシーポリシー
                </button>
              }
            />
            （越境移転・委託先への提供を含む）に
            <Label htmlFor="agree-privacy" className="cursor-pointer font-medium">
              同意します
            </Label>
          </ConsentRow>

          <ConsentRow
            id="agree-tokushoho"
            checked={agreeToTokushoho}
            onChange={(v) => setValue("agreeToTokushoho", v, { shouldValidate: true })}
            error={errors.agreeToTokushoho?.message}
          >
            <LegalDialog
              defaultTab="tokushoho"
              trigger={
                <button type="button" className="font-medium text-accent underline-offset-4 hover:underline">
                  特定商取引法に基づく表記
                </button>
              }
            />
            の内容を
            <Label htmlFor="agree-tokushoho" className="cursor-pointer font-medium">
              確認しました
            </Label>
          </ConsentRow>
        </fieldset>
      </Step>

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            登録中...
          </>
        ) : (
          "アカウント作成"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        すでにアカウントをお持ちですか？{" "}
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          ログイン
        </Link>
      </p>
    </form>
  );
}

/* ───────── Subcomponents ───────── */

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive" aria-label="必須">
      *
    </span>
  );
}

function OptionalMark() {
  return (
    <span className="ml-1 text-xs font-normal text-muted-foreground">（任意）</span>
  );
}

function StepProgress({ activeStep }: { activeStep: 1 | 2 | 3 | 4 }) {
  const steps: Array<{ n: 1 | 2 | 3 | 4; label: string }> = [
    { n: 1, label: "招待コード" },
    { n: 2, label: "アカウント" },
    { n: 3, label: "プロフィール" },
    { n: 4, label: "同意" },
  ];
  return (
    <ol
      aria-label="登録ステップ"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground"
    >
      {steps.map((s) => {
        const isActive = activeStep === s.n;
        const isDone = activeStep > s.n;
        return (
          <li
            key={s.n}
            aria-current={isActive ? "step" : undefined}
            className={`flex items-center gap-1.5 [&:not(:last-child)]:after:ml-2 [&:not(:last-child)]:after:inline-block [&:not(:last-child)]:after:h-px [&:not(:last-child)]:after:w-3 [&:not(:last-child)]:after:bg-border [&:not(:last-child)]:after:content-[''] ${
              isActive
                ? "text-foreground"
                : isDone
                ? "text-accent-strong"
                : ""
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isActive ? "bg-accent" : isDone ? "bg-accent-strong" : "bg-border"
              }`}
            />
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function Step({
  number,
  title,
  caption,
  children,
  accentIcon,
  isLast,
}: {
  number: number;
  title: string;
  caption?: string;
  children: React.ReactNode;
  accentIcon?: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <section className="relative" data-step={number}>
      {/* 縦connector線 (最後のStep以外) */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[13px] top-7 -bottom-3 w-px bg-border"
        />
      )}
      <header className="relative z-[1] flex items-start gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent-strong ring-1 ring-accent/30">
          {accentIcon ?? number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
          {caption && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{caption}</p>
          )}
        </div>
      </header>
      <div className="ml-10 mt-3">{children}</div>
    </section>
  );
}

function ConsentRow({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          className="mt-0.5"
          aria-invalid={Boolean(error) || undefined}
        />
        <div className="text-sm leading-relaxed text-foreground">{children}</div>
      </div>
      {error && <p className={`pl-[26px] ${fieldHelpClass}`}>{error}</p>}
    </div>
  );
}
