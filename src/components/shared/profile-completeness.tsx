"use client";

import Link from "next/link";
import { UserCircle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useProfileCompleteness,
  type CompletenessFieldCheck,
} from "@/hooks/queries/use-profile-completeness";
import type { Profile } from "@/types";

interface ProfileCompletenessProps {
  profile: Profile;
  /** When true, hides the link to /profile (used on the profile page itself) */
  hideLink?: boolean;
}

export function ProfileCompleteness({ profile, hideLink }: ProfileCompletenessProps) {
  const result = useProfileCompleteness(profile);
  const [expanded, setExpanded] = useState(false);

  if (!result) return null;
  const { score, groups, missing } = result;

  if (score >= 100) {
    return (
      <Card data-tour="completeness-card">
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="ds-kpi-label">プロフィール完成度</p>
            <UserCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="ds-kpi-number-md text-foreground">100</span>
            <span className="text-base text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-success">
            プロフィール登録項目をすべて満たしました。会議分析を重ねるごとに、マッチング精度はさらに磨かれます。
          </p>
        </CardContent>
      </Card>
    );
  }

  // missing を「効果が大きい順 (points 降順)」で 3 件 + その他集約
  const sortedMissing = [...missing].sort((a, b) => b.points - a.points);
  const top3 = sortedMissing.slice(0, 3);
  const restPoints = sortedMissing.slice(3).reduce((s, f) => s + f.points, 0);
  const topMissingLabel = sortedMissing[0]?.label;

  return (
    <Card data-tour="completeness-card">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="ds-kpi-label">プロフィール完成度</p>
          <UserCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-1">
          <span className="ds-kpi-number-md text-foreground">{score}</span>
          <span className="text-base text-muted-foreground">%</span>
          <span className="ml-2 text-xs text-muted-foreground">/ 100</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {score === 0
            ? "これから1つずつ埋めていきましょう。まずは下の項目から。"
            : score < 30
            ? "これから1つずつ埋めていきましょう。最初は『お名前』『会社名』からどうぞ。"
            : score < 60
            ? "基本情報の次は、自己紹介と『提供できること』を充実させましょう。"
            : score < 90
            ? topMissingLabel
              ? `順調に進んでいます。次は「${topMissingLabel}」を埋めると、AI 推薦の効きが大きく変わります。`
              : "順調に進んでいます。残りの項目を埋めると、AI 推薦の効きが大きく変わります。"
            : "ほぼ完成。最後の数項目を埋めると、AI 推薦に必要な前提条件がすべて揃います。"}
        </p>

        <div
          role="progressbar"
          aria-label="プロフィール完成度"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-gradient-brand transition-[width] duration-500"
            style={{ width: `${score}%` }}
          />
        </div>

        {top3.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {top3.map((f) => (
              <MissingItem key={f.key} item={f} />
            ))}
            {sortedMissing.length > 3 && (
              <li>
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1 text-xs text-muted-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                >
                  <span>
                    他 {sortedMissing.length - 3} 項目 (+{restPoints}%)
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {expanded && (
                  <ul className="mt-1.5 space-y-1.5 pl-2.5">
                    {sortedMissing.slice(3).map((f) => (
                      <MissingItem key={f.key} item={f} />
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        )}

        {/* グループ別 mini meter (groups の bar 表示) */}
        <details className="group/detail rounded-md border border-border bg-muted/40">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70">
            <span>カテゴリ別の達成度</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/detail:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="space-y-2 px-3 pb-3 pt-1">
            {groups.map((g) => {
              const isLever = g.id === "tldv";
              return (
                <li key={g.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1 text-foreground">
                      <span>{g.label}</span>
                      {isLever && (
                        <span
                          className="rounded-sm bg-accent/15 px-1 py-0.5 text-[10px] font-medium text-accent"
                          aria-label="推薦精度を引き上げる主要レバー"
                          title="会議分析の蓄積回数が AI 推薦の精度を最も引き上げます"
                        >
                          ★ 推薦精度 lever
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {g.earned} / {g.total}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${(g.earned / g.total) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </details>

        {!hideLink && (
          <Button variant="outline" size="sm" className="w-fit" render={<Link href="/profile" />}>
            プロフィールを編集
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function MissingItem({ item }: { item: CompletenessFieldCheck }) {
  const isLever = item.key.startsWith("tldv");
  return (
    <li className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <div className="min-w-0">
          <span className="text-foreground">{item.label}</span>
          {isLever && (
            <span
              className="ml-1 text-[10px] font-medium text-accent"
              aria-label="マッチング精度の核となる項目"
            >
              (マッチング精度の核)
            </span>
          )}
          {item.hint && <span className="ml-1 text-muted-foreground/80">— {item.hint}</span>}
        </div>
      </div>
      <span className="shrink-0 font-medium text-accent">+{item.points}%</span>
    </li>
  );
}
