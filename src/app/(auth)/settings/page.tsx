"use client";

import { Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Video className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">tl;dv 連携</p>
                <p className="text-xs text-muted-foreground">未接続</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              tl;dvのミーティング記録を接続すると、あなたの関心や専門領域をAIが分析し、
              本当に会うべき人をご紹介できます。
            </p>
            <Button size="sm" render={<a href="#tldv-connect" />}>
              接続する
            </Button>
          </div>
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
