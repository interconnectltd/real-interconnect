"use client";

import { scoreLabel } from "@/lib/constants";

export function ScoreBar({
  label,
  score,
  preliminary = false,
}: {
  label: string;
  score: number;
  preliminary?: boolean;
}) {
  const pct = Math.min(100, Math.round(score * 100));
  const valueLabel = scoreLabel(score);
  return (
    <div className="space-y-1.5">
      <div
        className={`flex items-center justify-between text-xs ${preliminary ? "text-muted-foreground/80" : "text-muted-foreground"}`}
      >
        <span className="font-medium">{label}</span>
        <span className="text-base font-semibold tabular-nums text-foreground">
          {valueLabel}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${valueLabel} (${pct}%)${preliminary ? "・暫定" : ""}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 bg-gradient-brand ${
            preliminary ? "opacity-60" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ReasonList({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="space-y-1.5">
      {reasons.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span
            className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
            aria-hidden="true"
          />
          <span className="leading-relaxed">{r}</span>
        </li>
      ))}
    </ul>
  );
}
