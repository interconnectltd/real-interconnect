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
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">プロフィール完成度: {score}%</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              プロフィールを充実させるとマッチング精度が向上します
            </p>
          </div>
          <UserCircle className="h-5 w-5 text-primary" />
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-2 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${score}%` }}
          />
        </div>

        {/* Missing fields */}
        {missing.length > 0 && (
          <ul className="mt-3 space-y-1">
            {missing.map((f) => (
              <li key={f.key} className="text-xs text-muted-foreground">
                <span className="mr-1">&#x2022;</span>
                {f.hint}
              </li>
            ))}
          </ul>
        )}

        {!hideLink && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            render={<Link href="/profile" />}
          >
            プロフィールを編集
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
