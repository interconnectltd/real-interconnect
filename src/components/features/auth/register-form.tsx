"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { LegalDialog, type LegalTab } from "@/components/legal/legal-dialog";
import { getSiteUrl } from "@/lib/site-url";
import { PasswordStrength } from "@/components/features/auth/password-strength";

/**
 * HIBP (Have I Been Pwned) k-anonymity check.
 * password の SHA-1 先頭 5 文字だけを送り、残りを返却 hash 群と比較。
 * password 自体は送信しない。CSP connect-src に api.pwnedpasswords.com を許可済。
 *
 * 失敗時 (network/timeout) は安全側 (=チェックスキップ) で続行。
 */
async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const enc = new TextEncoder().encode(password);
    const hashBuf = await crypto.subtle.digest("SHA-1", enc);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: "GET",
      mode: "cors",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const text = await res.text();
    return text.split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count ?? 0) > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Supabase Auth signup の error_code → 日本語ユーザー向けメッセージ。
 *
 * 設計方針:
 *   - `user_already_exists` は意図的に含めない (anti-enumeration: onSubmit で
 *     /login?registered=true へ silent redirect させ既存ユーザー判定を秘匿する)。
 *   - その他の code は具体メッセージで UX を上げる。ユーザーが何を直せば
 *     良いか分かるようにする。
 *   - Supabase docs: https://supabase.com/docs/reference/javascript/auth-error-codes
 */
const SIGNUP_ERROR_MESSAGES: Record<string, string> = {
  email_address_invalid:
    "このメールアドレスは利用できません。実在するメールアドレス (例: name@gmail.com) を入力してください。",
  weak_password:
    "パスワードが推測されやすいか、流出履歴があります。別の文字列にしてください。",
  over_email_send_rate_limit:
    "短時間に多くのメール送信が発生しました。30 分ほど経ってから再度お試しください。",
  over_signup_request_rate_limit:
    "短時間に多くの登録試行が発生しました。しばらく待ってから再度お試しください。",
  signup_disabled:
    "現在新規登録を受け付けていません。お問い合わせください。",
  email_provider_disabled:
    "メールアドレスでの登録は現在無効になっています。",
  validation_failed:
    "入力内容に不備があります。各項目をご確認ください。",
};

const labelClass = "text-[13px] font-medium text-foreground";
const fieldHelpClass = "text-xs text-destructive";
const selectClass =
  // pr-9 で chevron 領域を縮小して長文 option (例: 情報・ソフトウェアサービス) の clip 余地確保
  "h-11 w-full rounded-lg border border-input bg-card pl-3 pr-9 py-2 text-base sm:text-sm transition-[box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 appearance-none";
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
  // LegalDialog はシングルインスタンス (Wave7 G C-1: 4 inst 同居 backdrop 残留事故 + Wave9: tap 反応性根治)
  const [legalDialog, setLegalDialog] = useState<{ open: boolean; tab: LegalTab }>({
    open: false,
    tab: "terms",
  });
  const openLegal = (tab: LegalTab) => setLegalDialog({ open: true, tab });

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
    control,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // 4 ステップフォームで全部埋めてから Submit して初めてエラー出る UX を回避。
    // フィールド離脱時 (touched) に validate して早期 feedback。
    mode: "onTouched",
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

  // useWatch は subscription ベースで React Compiler の memoization と互換。
  // watch() の stale closure を避け、Checkbox の controlled checked を frame 落ち無く同期する。
  const agreeToTerms = useWatch({ control, name: "agreeToTerms" });
  const agreeToPrivacy = useWatch({ control, name: "agreeToPrivacy" });
  const agreeToTokushoho = useWatch({ control, name: "agreeToTokushoho" });
  const passwordValue = useWatch({ control, name: "password" }) ?? "";

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

    // 招待コード validate のみ (anon)。実消費は handle_new_user trigger 側で atomic 実行。
    try {
      log.info("[register] POST /api/v1/invitation (validate)");
      const res = await fetch("/api/v1/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.invitationCode }),
      });
      log.info("[register] invitation response", { status: res.status, ok: res.ok });
      if (!res.ok) {
        const bodyText = await res.text();
        const parsed = bodyText ? JSON.parse(bodyText) : null;
        const errMsg = parsed?.error?.message ?? "招待コードが無効です";
        setError(errMsg);
        setLoading(false);
        log.groupEnd();
        return;
      }
      log.info("[register] invitation OK");
    } catch (e) {
      log.error("[register] invitation fetch threw", e);
      setError("招待コードの検証に失敗しました");
      setLoading(false);
      log.groupEnd();
      return;
    }

    // HIBP 漏洩 password 検出 (k-anonymity SHA-1 先頭 5 文字のみ送信)
    const pwned = await isPasswordPwned(data.password);
    if (pwned) {
      setError(
        "このパスワードは過去の漏えい事例に含まれています。別のパスワードを設定してください。",
      );
      setLoading(false);
      log.groupEnd();
      return;
    }

    const supabase = createClient();
    // PII (email) は本番ログに残さない
    log.info("[register] supabase.auth.signUp");
    const { data: signUpData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      // 確認メールから戻る先を **server 固定 env** で明示
      // (audit Wave1 #6: Supabase Site URL allowlist を緩める社会工学攻撃の入口を塞ぐ)
      options: {
        emailRedirectTo: `${getSiteUrl()}/login?confirmed=true`,
        // raw_user_meta_data には UI 表示しない最小限のみ。
        // consent: {...} は **載せない** (audit Wave1 C-05: クライアント自己申告で
        // 法的証跡を汚染するため、server-side user_terms_acceptances を単一情報源とする)。
        // invitation_code は handle_new_user trigger が atomic に消費 (TOCTOU 回避)。
        data: {
          name: data.name,
          company: data.company ?? "",
          position: data.position ?? "",
          industry: data.industry,
          bio: data.bio ?? "",
          invitation_code: data.invitationCode.trim(),
        },
      },
    });
    log.info("[register] signUp result", {
      hasUser: signUpData?.user != null,
      session: signUpData?.session ? "present" : "null",
    });

    if (authError) {
      // Supabase 新版は `code`、旧版は `error_code` フィールド。両方拾う。
      const errCode =
        (authError as { code?: string }).code ??
        (authError as { error_code?: string }).error_code ??
        "";
      log.error("[register] signUp error", { code: errCode });
      const status = (authError as { status?: number }).status ?? 0;
      const msg = (authError.message ?? "").toLowerCase();

      // ── ① Anti-enumeration: 既存メールは generic redirect で隠す。
      //    既存ユーザー判定は本来 error_code === "user_already_exists" だけで十分。
      //    legacy 互換のため msg 文字列 + (errCode 欠落時のみ 422) も safety-net に追加。
      if (
        errCode === "user_already_exists" ||
        msg.includes("user already registered") ||
        (!errCode && status === 422)
      ) {
        log.info("[register] anti-enumeration: existing email → silent redirect");
        log.groupEnd();
        router.push("/login?registered=true");
        return;
      }

      // ── ② Supabase error_code → 具体メッセージ map (UX 改善)
      //    `user_already_exists` は意図的に含まない (上の anti-enumeration で吸う)。
      let display = SIGNUP_ERROR_MESSAGES[errCode];

      // ── ③ status / message ベース fallback (errCode が空 / 未知の場合)
      if (!display) {
        if (
          msg.includes("weak password") ||
          (status === 400 && msg.includes("password"))
        ) {
          display = SIGNUP_ERROR_MESSAGES.weak_password!;
        } else if (status === 400 && msg.includes("email") && msg.includes("invalid")) {
          display = SIGNUP_ERROR_MESSAGES.email_address_invalid!;
        } else if (status === 429) {
          display = SIGNUP_ERROR_MESSAGES.over_email_send_rate_limit!;
        } else if (status >= 500) {
          display =
            "サーバーで一時的なエラーが発生しています。しばらく待ってから再度お試しください。";
        } else {
          display = "登録に失敗しました。入力内容を確認してください。";
        }
      }

      setError(display);
      setLoading(false);
      log.groupEnd();
      return;
    }

    // 招待コードは handle_new_user trigger 内 SECURITY DEFINER の atomic RPC で消費済。
    // (audit Wave1 C-01/02/11: TOCTOU + IDOR + 二重消費の根治)

    log.info("[register] POST /api/v1/legal/accept");
    // body 必須化 (法的証跡偽装防止 / Sec audit 2026-05-07)
    // 失敗は致命的 (法的同意ログ欠落) のため UI でエラー表示し abort。
    try {
      const r = await fetch("/api/v1/legal/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: true,
          privacy: true,
          tokushoho: true,
          ai_cross_border: true,
        }),
      });
      if (!r.ok && r.status !== 401) {
        // 401 は email 確認待ちで session 未確立。onboarding/consent gate で再記録される設計。
        const t = await r.text().catch(() => "");
        log.warn("[register] legal/accept non-OK", { status: r.status, body: t });
      }
    } catch (e) {
      log.warn("[register] legal/accept failed", e);
    }

    log.info("[register] redirect to /login?registered=true");
    log.groupEnd();
    router.push("/login?registered=true");
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (validationErrors) => {
        log.warn("[register] zod validation blocked submit", {
          fields: Object.keys(validationErrors),
        });
        const firstKey = Object.keys(validationErrors)[0];
        if (firstKey) {
          requestAnimationFrame(() => {
            // RHF の register() 経由でない Checkbox 系 (agreeTo*) は name 属性が無いため
            // [name=] では取れない → id (例: agree-terms) も fallback で探索する。
            const idGuess = `agree-${firstKey.replace(/^agreeTo/, "").toLowerCase()}`;
            const el =
              document.querySelector<HTMLElement>(`[name="${firstKey}"]`) ??
              document.getElementById(idGuess) ??
              document.querySelector<HTMLElement>(`[id="${firstKey}"]`);
            if (el) {
              el.focus({ preventScroll: true });
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
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
          className="scroll-mt-20 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/30"
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
              placeholder="10文字以上 (英大小文字 + 数字)"
              enterKeyHint="next"
              aria-invalid={Boolean(errors.password) || undefined}
              aria-describedby={
                errors.password
                  ? "reg-password-error reg-password-strength"
                  : "reg-password-strength"
              }
              // iOS Strong Password サジェスチョンが zod ルールと合致するよう制約を申告
              {...({
                passwordrules:
                  "minlength: 10; required: lower; required: upper; required: digit;",
              } as Record<string, string>)}
              {...register("password")}
            />
            {/* リアルタイム強度メーター (Wave7 sec audit V-2) */}
            <div id="reg-password-strength">
              <PasswordStrength password={passwordValue} />
            </div>
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
                className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
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
        <fieldset className="space-y-5 rounded-lg border border-border bg-muted/40 p-4">
          <legend className="sr-only">法務文書への同意</legend>
          <p className="text-xs leading-relaxed text-muted-foreground">
            下記リンクは全てモーダルで開きます。入力中のフォーム内容は失われません。
          </p>
          {/* 3 文書をまとめて (terms tab で開く) */}
          <button
            type="button"
            onClick={() => openLegal("terms")}
            aria-haspopup="dialog"
            className="inline-flex min-h-[44px] items-center px-1 text-sm font-medium text-accent underline underline-offset-4"
          >
            3文書をまとめて読む（モーダル）
          </button>

          {/* === 1. 利用規約 ===
              旧: ConsentRow children に button + 説明 + Label を全部詰めて Checkbox が
                  content stack の TOP に貼り付き、Label が遠く離れて見える致命事故。
              新: button + 説明を ConsentRow の **外側** に出し、Checkbox と Label を
                  真横に並べる (Checkbox = 「上記内容に同意します」 の隣) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => openLegal("terms")}
              aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center px-1 text-sm font-medium text-accent underline underline-offset-2"
            >
              利用規約を読む
            </button>
            <p className="text-xs text-muted-foreground">
              （AI分析・米国への越境移転を含む）
            </p>
            <ConsentRow
              id="agree-terms"
              checked={agreeToTerms}
              onChange={(v) => setValue("agreeToTerms", v, { shouldValidate: true })}
              error={errors.agreeToTerms?.message}
            >
              <Label
                htmlFor="agree-terms"
                className="cursor-pointer font-medium"
              >
                上記内容に同意します
              </Label>
            </ConsentRow>
          </div>

          {/* === 2. プライバシーポリシー === */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => openLegal("privacy")}
              aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center px-1 text-sm font-medium text-accent underline underline-offset-2"
            >
              プライバシーポリシーを読む
            </button>
            <p className="text-xs text-muted-foreground">
              （越境移転・委託先への提供を含む）
            </p>
            <ConsentRow
              id="agree-privacy"
              checked={agreeToPrivacy}
              onChange={(v) => setValue("agreeToPrivacy", v, { shouldValidate: true })}
              error={errors.agreeToPrivacy?.message}
            >
              <Label
                htmlFor="agree-privacy"
                className="cursor-pointer font-medium"
              >
                上記内容に同意します
              </Label>
            </ConsentRow>
          </div>

          {/* === 3. 特定商取引法 === */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => openLegal("tokushoho")}
              aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center px-1 text-sm font-medium text-accent underline underline-offset-2"
            >
              特定商取引法に基づく表記を読む
            </button>
            <ConsentRow
              id="agree-tokushoho"
              checked={agreeToTokushoho}
              onChange={(v) => setValue("agreeToTokushoho", v, { shouldValidate: true })}
              error={errors.agreeToTokushoho?.message}
            >
              <Label
                htmlFor="agree-tokushoho"
                className="cursor-pointer font-medium"
              >
                内容を確認しました
              </Label>
            </ConsentRow>
          </div>
        </fieldset>
      </Step>

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
            登録中...
          </>
        ) : (
          "アカウント作成"
        )}
      </Button>

      {/* Zod バリデーション失敗時の summary alert (フィールド単独の inline エラーが
          スクロール外で見えない事故を防ぐ) */}
      {Object.keys(errors).length > 0 && (
        <p
          role="alert"
          aria-live="polite"
          className="text-center text-xs text-destructive"
        >
          入力に不備があります。赤字の項目をご確認ください。
        </p>
      )}

      <p className="text-center text-sm text-muted-foreground">
        すでにアカウントをお持ちですか？{" "}
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          ログイン
        </Link>
      </p>

      {/* シングルインスタンス LegalDialog (タブ切替で 3 文書を表示) */}
      <LegalDialog
        open={legalDialog.open}
        onOpenChange={(open) => setLegalDialog((s) => ({ ...s, open }))}
        tab={legalDialog.tab}
        onTabChange={(tab) => setLegalDialog((s) => ({ ...s, tab }))}
      />
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
      {/* 縦connector線 (最後のStep以外)。
          pointer-events-none 必須: Mobile で 1px 帯がタップ吸収する ghost click を回避。 */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[13px] top-7 -bottom-3 w-px bg-border"
        />
      )}
      <header className="relative z-[1] flex items-start gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-xs font-semibold text-accent-strong ring-1 ring-accent/30">
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
  // 行全体をタップ可能にして「タップしてもチェックが入らない」を根絶。
  // 内側の <button type="button"> (LegalDialog trigger) と <label htmlFor> は
  // それぞれ独立 click 経路を持つため、delegation で重複呼び出しを除外する。
  return (
    <div className="space-y-1">
      <div
        role="presentation"
        onClick={(e) => {
          // synthetic event の bubbling 上、内側 button onClick は既に発火済。
          // 念のため defaultPrevented も短絡条件に追加して二重発火を完全防止。
          if (e.defaultPrevented) return;
          const target = e.target as HTMLElement;
          if (target.closest("button[type='button']")) return; // LegalDialog trigger
          if (target.closest("a")) return; // 補助リンク
          if (target.closest("[data-slot='checkbox']")) return; // Base UI Checkbox 自身
          if (target.closest("label[for]")) return; // Label htmlFor の native 経路
          onChange(!checked);
        }}
        className="-mx-2 -my-0.5 flex cursor-pointer items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-accent/5 active:bg-accent/10"
      >
        <Checkbox
          id={id}
          name={id}
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          className="mt-0.5"
          aria-invalid={Boolean(error) || undefined}
        />
        <div className="text-sm leading-relaxed text-foreground select-none">
          {children}
        </div>
      </div>
      {error && <p className={`pl-[26px] ${fieldHelpClass}`}>{error}</p>}
    </div>
  );
}
