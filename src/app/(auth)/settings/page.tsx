"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Video,
  LogOut,
  KeyRound,
  Bell,
  Users,
  Handshake,
  CalendarCheck,
  Brain,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSupabase } from "@/providers/supabase-provider";
import { useAnalysisCount } from "@/hooks/queries/use-ai-profile";
import { toast } from "sonner";

const NOTIFICATION_STORAGE_KEY = "interconnect_notification_prefs";

interface NotificationPrefs {
  connection: boolean;
  matching: boolean;
  meeting: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  connection: true,
  matching: true,
  meeting: true,
};

function loadNotificationPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return DEFAULT_PREFS;
}

function saveNotificationPrefs(prefs: NotificationPrefs) {
  try {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export default function SettingsPage() {
  const { supabase, user } = useSupabase();
  const router = useRouter();
  const { data: analysisCount } = useAnalysisCount();

  // Password change
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Notification prefs
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setNotifPrefs(loadNotificationPrefs());
  }, []);

  const handleNotifChange = useCallback(
    (key: keyof NotificationPrefs, checked: boolean) => {
      setNotifPrefs((prev) => {
        const next = { ...prev, [key]: checked };
        saveNotificationPrefs(next);
        return next;
      });
    },
    [],
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handlePasswordChange() {
    if (!newPassword) {
      toast.error("新しいパスワードを入力してください");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("パスワードは6文字以上で入力してください");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("パスワードが一致しません");
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      toast.success("パスワードを変更しました");
      setPasswordDialogOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "パスワードの変更に失敗しました";
      toast.error(message);
    } finally {
      setPasswordLoading(false);
    }
  }

  const hasAnalyses = typeof analysisCount === "number" && analysisCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          アカウントとアプリケーションの設定
        </p>
      </div>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">アカウント</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              メールアドレス
            </Label>
            <p className="text-sm">{user?.email ?? "—"}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Dialog
              open={passwordDialogOpen}
              onOpenChange={setPasswordDialogOpen}
            >
              <DialogTrigger
                render={
                  <Button variant="outline" size="sm" />
                }
              >
                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                パスワードを変更
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>パスワードを変更</DialogTitle>
                  <DialogDescription>
                    新しいパスワードを入力してください（6文字以上）
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password">新しいパスワード</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password">パスワード確認</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handlePasswordChange}
                    disabled={passwordLoading}
                  >
                    {passwordLoading ? "変更中..." : "変更する"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              ログアウト
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notification preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            通知設定
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">コネクション通知</span>
              </div>
              <Checkbox
                checked={notifPrefs.connection}
                onCheckedChange={(checked) =>
                  handleNotifChange("connection", checked)
                }
              />
            </label>
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">マッチング通知</span>
              </div>
              <Checkbox
                checked={notifPrefs.matching}
                onCheckedChange={(checked) =>
                  handleNotifChange("matching", checked)
                }
              />
            </label>
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">会議通知</span>
              </div>
              <Checkbox
                checked={notifPrefs.meeting}
                onCheckedChange={(checked) =>
                  handleNotifChange("meeting", checked)
                }
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* AI Profile link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" />
            AIプロフィール管理
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            AIがミーティング記録から分析したあなたのプロフィールを確認・管理できます。
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/settings/ai-profile" />}
          >
            AIプロフィールを見る
            {typeof analysisCount === "number" && (
              <Badge variant="secondary" className="ml-2">
                分析 {analysisCount}件
              </Badge>
            )}
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>

      {/* tl;dv connection */}
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
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">tl;dv 連携</p>
                  {hasAnalyses ? (
                    <Badge variant="secondary">接続済み</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      未接続
                    </span>
                  )}
                </div>
                {hasAnalyses && (
                  <p className="text-xs text-muted-foreground">
                    {analysisCount}件のミーティングを分析済み
                  </p>
                )}
              </div>
            </div>
            {!hasAnalyses && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                tl;dvのミーティング記録を接続すると、あなたの関心や専門領域をAIが分析し、
                本当に会うべき人をご紹介できます。
              </p>
            )}
            <Button
              size="sm"
              variant={hasAnalyses ? "outline" : "default"}
              render={<a href="#tldv-connect" />}
            >
              {hasAnalyses ? "設定を管理" : "接続する"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            危険な操作
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            アカウントを削除すると、すべてのデータが完全に削除されます。この操作は元に戻せません。
          </p>
          <Button variant="destructive" size="sm" disabled>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            アカウント削除
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            この機能は近日対応予定です
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
