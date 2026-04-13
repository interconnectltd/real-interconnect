"use client";

import { scoreLabel } from "@/lib/constants";

export function ScoreBar({ label, score, preliminary = false }: { label: string; score: number; preliminary?: boolean }) {
  const pct = Math.min(100, Math.round(score * 100));
  return (
    <div className="space-y-1">
      <div className={`flex justify-between text-xs ${preliminary ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
        <span>{label}</span>
        <span>{scoreLabel(score)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${preliminary ? "bg-primary/30" : "bg-primary"}`}
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
        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}
