"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TldvConnectCta } from "@/components/shared/tldv-connect-cta";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          アカウントとアプリケーションの設定
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ミーティング分析</CardTitle>
        </CardHeader>
        <CardContent>
          <TldvConnectCta />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">通知設定</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label>ブラウザ通知</Label>
            <p className="text-sm text-muted-foreground">準備中</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">テーマ</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            ダークモードは今後対応予定です
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
