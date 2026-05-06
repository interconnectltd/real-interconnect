"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";

const KIND_OPTIONS = [
  { value: "general", label: "一般のお問い合わせ" },
  { value: "support", label: "サービス利用のサポート" },
  { value: "data_disclosure", label: "個人情報の開示請求" },
  { value: "data_deletion", label: "個人情報の削除請求" },
  { value: "tokushoho", label: "特定商取引法に基づく開示請求" },
  { value: "urgent_removal", label: "緊急削除" },
  { value: "press", label: "取材・メディア" },
  { value: "partnership", label: "業務提携" },
] as const;

const FormSchema = z.object({
  sender_name: z.string().trim().min(1, "氏名を入力してください").max(100),
  sender_email: z
    .string()
    .email("有効なメールアドレスを入力してください")
    .max(254),
  kind: z.enum([
    "general",
    "support",
    "data_disclosure",
    "data_deletion",
    "tokushoho",
    "urgent_removal",
    "press",
    "partnership",
  ]),
  subject: z.string().trim().min(1, "件名を入力してください").max(200),
  body: z.string().trim().min(10, "10 文字以上で本文を入力してください").max(5000),
});

type FormValues = z.infer<typeof FormSchema>;

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { kind: "general" },
  });

  async function onSubmit(values: FormValues) {
    setErrorMsg(null);
    try {
      await api.post("/contact", values);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "BAD_REQUEST") {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          "送信に失敗しました。時間をおいて再度お試しいただくか、メールにてご連絡ください。",
        );
      }
    }
  }

  if (submitted) {
    return (
      <div className="mt-8 rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">お問い合わせを受け付けました</p>
            <p className="mt-1 text-xs leading-relaxed">
              担当より追ってご連絡いたします。確認メールが届かない場合は
              迷惑メールフォルダもご確認ください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sender_name">お名前</Label>
          <Input
            id="sender_name"
            autoComplete="name"
            aria-invalid={Boolean(errors.sender_name) || undefined}
            aria-describedby={errors.sender_name ? "name-err" : undefined}
            {...register("sender_name")}
          />
          {errors.sender_name && (
            <p id="name-err" className="text-xs text-destructive">
              {errors.sender_name.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sender_email">メールアドレス</Label>
          <Input
            id="sender_email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.sender_email) || undefined}
            aria-describedby={errors.sender_email ? "email-err" : undefined}
            {...register("sender_email")}
          />
          {errors.sender_email && (
            <p id="email-err" className="text-xs text-destructive">
              {errors.sender_email.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="kind">用件の種類</Label>
        <select
          id="kind"
          {...register("kind")}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="subject">件名</Label>
        <Input
          id="subject"
          aria-invalid={Boolean(errors.subject) || undefined}
          aria-describedby={errors.subject ? "subject-err" : undefined}
          {...register("subject")}
        />
        {errors.subject && (
          <p id="subject-err" className="text-xs text-destructive">
            {errors.subject.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">本文</Label>
        <textarea
          id="body"
          rows={6}
          maxLength={5000}
          aria-invalid={Boolean(errors.body) || undefined}
          aria-describedby={errors.body ? "body-err" : undefined}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 sm:text-sm"
          placeholder="本文をご記入ください (10 字以上 5000 字以内)"
          {...register("body")}
        />
        {errors.body && (
          <p id="body-err" className="text-xs text-destructive">
            {errors.body.message}
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        送信内容は「INTER CONNECT株式会社」が個人情報保護方針に従って取り扱います。
        受付後、原則 2 営業日以内 (緊急削除は 4 時間以内) にご連絡いたします。
      </p>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            送信中...
          </>
        ) : (
          "送信する"
        )}
      </Button>
    </form>
  );
}
