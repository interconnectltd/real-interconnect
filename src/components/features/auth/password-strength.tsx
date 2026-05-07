"use client";

import { cn } from "@/lib/utils";

/**
 * パスワード強度メーター (簡易版)。
 *
 * Wave7 sec audit: zod 検証は Submit 時のみで、ユーザは「弱いパスワードでも通る?」と
 * 勘違いする → 入力中にリアルタイムで強度を表示する。
 *
 * スコア計算 (0-4):
 *   - 10 文字以上: +1
 *   - 大文字: +1
 *   - 小文字: +1
 *   - 数字: +1
 *   - 記号 or 14 文字以上: +1 (上限 4)
 */
function calcScore(password: string): number {
  let s = 0;
  if (password.length >= 10) s++;
  if (/[A-Z]/.test(password)) s++;
  if (/[a-z]/.test(password)) s++;
  if (/\d/.test(password)) s++;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) s++;
  return Math.min(s, 4);
}

const LABELS = ["弱い", "やや弱い", "普通", "強い", "非常に強い"];
const BAR_COLORS = [
  "bg-destructive/70",
  "bg-warning/80",
  "bg-warning",
  "bg-success/80",
  "bg-success",
];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = calcScore(password);
  const label = LABELS[score] ?? "";
  return (
    <div
      className="mt-1.5 flex items-center gap-2 text-[11px]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-sm transition-colors",
              i < score ? BAR_COLORS[score] : "bg-muted",
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          "min-w-[5em] text-right tabular-nums",
          score <= 1
            ? "text-destructive"
            : score === 2
            ? "text-warning"
            : "text-success",
        )}
      >
        {label}
      </span>
    </div>
  );
}
