import type { Metadata } from "next";
import Link from "next/link";
import { Compass, MessageSquare, Mail, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "ヘルプ" };

const FAQ = [
  {
    q: "招待コードを忘れました",
    a: "ご紹介者から再度受け取るか、お問い合わせフォームから運営にご連絡ください。",
  },
  {
    q: "tl;dv の連携方法は?",
    a: "設定ページの「tl;dv 連携」から API キーを貼り付けるだけです。約2分で完了します。",
  },
  {
    q: "おすすめ精度を上げるには?",
    a: "プロフィールを充実させ (自己紹介 200文字以上推奨) + tl;dv で会話分析を 5回以上重ねると Lv3 (最高精度) になります。",
  },
  {
    q: "コネクション申請は取り消せますか?",
    a: "コネクションページの「申請中」タブから取り消し可能です。相手にも取り消し通知が届きます。",
  },
  {
    q: "ブロックしたい相手がいます",
    a: "プロフィールの右上メニューから「このユーザーをブロック」を選択。以降のおすすめからも除外されます。",
  },
  {
    q: "退会すると会話分析データはどうなりますか?",
    a: "退会後 30 日以内に全データを削除します。第三者に提供されることはありません。",
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="ds-eyebrow">Help</p>
        <h1 className="ds-h1 mt-1 tracking-tight text-foreground">よくある質問</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          主要な操作と仕組みを確認できます。
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-border">
            {FAQ.map((item) => (
              <li key={item.q} className="py-3 first:pt-0 last:pb-0">
                <details className="group/faq">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 list-none [&::-webkit-details-marker]:hidden">
                    <span className="text-sm font-medium text-foreground">
                      Q. {item.q}
                    </span>
                    <span className="text-xs text-muted-foreground transition-transform group-open/faq:rotate-180" aria-hidden="true">
                      ▾
                    </span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    A. {item.a}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-2">
            <Compass className="h-5 w-5 text-accent-strong" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">使い方ガイド</h2>
            <p className="text-xs text-muted-foreground">
              右下の「?」ボタンから、現在のページの主要機能を順に案内します。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2">
            <MessageSquare className="h-5 w-5 text-accent-strong" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">解決しない場合</h2>
            <p className="text-xs text-muted-foreground">
              運営にお問い合わせください。24時間以内に返信いたします。
            </p>
            <Button size="sm" variant="outline" render={<Link href="/contact" />}>
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              お問い合わせ
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
