"use client";

import Link from "next/link";
import { Calendar, ArrowRight, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CalendarPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="ds-eyebrow">Calendar</p>
        <h1 className="ds-h1 mt-1 tracking-tight text-foreground">カレンダー</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ミーティング履歴と予定を確認できます。
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-accent-strong" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                tl;dv で記録されたミーティング
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                tl;dv 連携を有効にすると、過去・新規ミーティングがここに自動集約されます。
                各会議をクリックすると要約・話題・次のアクションが見られます。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="accent" render={<Link href="/meetings" />}>
              ミーティング一覧へ
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button size="sm" variant="outline" render={<Link href="/settings#tldv-connect" />}>
              tl;dv 連携設定
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              Google / Apple カレンダー連携 (準備中)
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              外部カレンダーへの予定エクスポート機能を準備しています。
              リリース時に通知メールでお知らせします。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
