"use client";

import Link from "next/link";
import { UserCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/types";

interface FieldCheck {
  key: keyof Profile;
  label: string;
  hint: string;
  points: number;
}

const FIELDS: FieldCheck[] = [
  { key: "name", label: "お名前", hint: "名前を入力しましょう", points: 15 },
  { key: "company", label: "会社名", hint: "所属企業を追加しましょう", points: 15 },
  { key: "position", label: "役職", hint: "役職を追加しましょう", points: 15 },
  { key: "industry", label: "業種", hint: "業種を選択しましょう", points: 15 },
  { key: "bio", label: "自己紹介", hint: "自己紹介を書くとマッチング精度が大幅に向上します", points: 20 },
  { key: "contact_info", label: "連絡先", hint: "連絡先を追加しましょう", points: 10 },
  { key: "avatar_url", label: "プロフィール画像", hint: "プロフィール画像を設定しましょう", points: 10 },
];

export function calcProfileCompleteness(profile: Profile) {
  let score = 0;
  const missing: FieldCheck[] = [];
  for (const field of FIELDS) {
    const val = profile[field.key];
    if (val && typeof val === "string" && val.trim().length > 0) {
      score += field.points;
    } else {
      missing.push(field);
    }
  }
  return { score, missing };
}

interface ProfileCompletenessProps {
  profile: Profile;
  /** When true, hides the link to /profile (used on the profile page itself) */
  hideLink?: boolean;
}

export function ProfileCompleteness({ profile, hideLink }: ProfileCompletenessProps) {
  const { score, missing } = calcProfileCompleteness(profile);

  if (score >= 100) return null;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserCircle className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold text-foreground">
                プロフィール完成度
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              プロフィールを充実させるとマッチング精度が向上します
            </p>
          </div>
          <span className="ds-kpi-number text-2xl font-bold text-foreground">
            {score}%
          </span>
        </div>

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

        {missing.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {missing.slice(0, 3).map((f) => (
              <li
                key={f.key}
                className="flex items-start justify-between gap-2 text-xs text-muted-foreground"
              >
                <div className="flex min-w-0 items-start gap-1.5">
                  <span
                    className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">{f.hint}</span>
                </div>
                <span className="shrink-0 font-medium text-accent">+{f.points}%</span>
              </li>
            ))}
            {missing.length > 3 && (
              <li className="flex items-start justify-between gap-2 pl-2.5 text-xs text-muted-foreground/80">
                <span>他 {missing.length - 3} 項目</span>
                <span className="shrink-0 font-medium text-accent">
                  +{missing.slice(3).reduce((sum, f) => sum + f.points, 0)}%
                </span>
              </li>
            )}
          </ul>
        )}

        {!hideLink && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            render={<Link href="/profile" />}
          >
            プロフィールを編集
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
