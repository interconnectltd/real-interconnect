"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

/** Settings 各セクション用 spot icon (48×48) — CardTitle 左に共通配置 */
function SectionIcon({ name }: { name: string }) {
  return (
    <Image
      src={`/illustrations/settings-icon-${name}.png`}
      alt=""
      width={48}
      height={48}
      className="h-8 w-8 shrink-0"
      aria-hidden="true"
      priority={false}
    />
  );
}
import {
  Video,
  LogOut,
  KeyRound,
  Users,
  Handshake,
  CalendarCheck,
  Calendar,
  ChevronRight,
  Trash2,
  Plus,
  RefreshCw,
  Unlink,
  Loader2,
  X,
  Copy,
  Check,
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
import { useAgencyMe, useAgencyApplication } from "@/hooks/queries/use-agency";
import { useApplyAgency } from "@/hooks/mutations/use-agency-mutations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

interface CalendarConnection {
  id: string;
  provider: string;
  provider_email: string;
  last_synced_at: string | null;
  is_active: boolean;
}

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

interface DayRule {
  enabled: boolean;
  start: string;
  end: string;
}

type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

interface WeeklyTemplate {
  mon: DayRule;
  tue: DayRule;
  wed: DayRule;
  thu: DayRule;
  fri: DayRule;
  sat: DayRule;
  sun: DayRule;
}

interface SchedulingOverride {
  id: string;
  date: string;
  type: "block" | "custom";
  start?: string;
  end?: string;
  label?: string;
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  sun: "日",
};

const DAY_KEYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DEFAULT_TEMPLATE: WeeklyTemplate = {
  mon: { enabled: true, start: "10:00", end: "17:00" },
  tue: { enabled: true, start: "10:00", end: "17:00" },
  wed: { enabled: true, start: "10:00", end: "17:00" },
  thu: { enabled: true, start: "10:00", end: "17:00" },
  fri: { enabled: true, start: "10:00", end: "17:00" },
  sat: { enabled: false, start: "10:00", end: "17:00" },
  sun: { enabled: false, start: "10:00", end: "17:00" },
};

// 経営者ユーザーは早朝/深夜の MTG も多いため 24h × 30 分刻みで生成。
// 開始 00:00 〜 終了 23:30 (=最後の 30 分単位スロット開始時刻) を網羅。
function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 0; h <= 23; h++) {
    options.push(`${String(h).padStart(2, "0")}:00`);
    options.push(`${String(h).padStart(2, "0")}:30`);
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

// TODO: 通知設定をサーバーに永続化する（現在はlocalStorageのみ、デバイス間同期されない）
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
  const queryClient = useQueryClient();
  const { data: analysisCount, lastAnalyzedAt, isLoading: analysisLoading } = useAnalysisCount();

  // 代理店プログラム関連 (00063)
  const { data: agencyMe, isLoading: agencyMeLoading } = useAgencyMe();
  const { data: agencyApp, isLoading: agencyAppLoading } = useAgencyApplication();
  const applyAgency = useApplyAgency();
  const [applicantNote, setApplicantNote] = useState("");
  const [agencyApplyOpen, setAgencyApplyOpen] = useState(false);

  // Stripe 課金 (00064)
  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ["subscription-me"],
    queryFn: () =>
      api.get<{
        subscription: {
          status: string;
          cancel_at_period_end: boolean;
          current_period_end: string | null;
          current_period_start: string | null;
          canceled_at: string | null;
          trial_end: string | null;
          last_invoice_amount_jpy: number | null;
        } | null;
      }>("/billing/subscription"),
    staleTime: 30_000,
  });
  const [billingLoading, setBillingLoading] = useState(false);
  async function handleSubscribe() {
    setBillingLoading(true);
    try {
      const res = await api.post<{ url: string }>("/billing/checkout");
      if (res?.url) window.location.href = res.url;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "決済画面の作成に失敗しました",
      );
    } finally {
      setBillingLoading(false);
    }
  }
  async function handlePortal() {
    setBillingLoading(true);
    try {
      const res = await api.post<{ url: string }>("/billing/portal");
      if (res?.url) window.location.href = res.url;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "管理画面の作成に失敗しました",
      );
    } finally {
      setBillingLoading(false);
    }
  }

  const [tldvSyncing, setTldvSyncing] = useState(false);

  // Password change
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Calendar connection
  const [calendarConnection, setCalendarConnection] =
    useState<CalendarConnection | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [microsoftConnecting, setMicrosoftConnecting] = useState(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarDisconnecting, setCalendarDisconnecting] = useState(false);

  // ICS URL subscription
  const [icsExpanded, setIcsExpanded] = useState(false);
  const [icsUrl, setIcsUrl] = useState("");
  const [icsSubmitting, setIcsSubmitting] = useState(false);

  // Calendar feed
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);

  // Availability rules
  const [weeklyTemplate, setWeeklyTemplate] = useState<WeeklyTemplate>(DEFAULT_TEMPLATE);
  const [overrides, setOverrides] = useState<SchedulingOverride[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [newOverrideDate, setNewOverrideDate] = useState("");
  const [newOverrideType, setNewOverrideType] = useState<"block" | "custom">("block");
  const [newOverrideStart, setNewOverrideStart] = useState("10:00");
  const [newOverrideEnd, setNewOverrideEnd] = useState("17:00");
  const [addingOverride, setAddingOverride] = useState(false);

  const fetchAvailabilityRules = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/scheduling/rules");
      if (res.ok) {
        const json = await res.json();
        const rules: Array<{ day_of_week: number; start_time: string; end_time: string; is_active: boolean }> = Array.isArray(json.data) ? json.data : [];
        if (rules.length > 0) {
          const dayMap: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
          const template: WeeklyTemplate = { ...DEFAULT_TEMPLATE };
          // Reset all days to disabled first
          for (const key of DAY_KEYS) {
            template[key] = { ...DEFAULT_TEMPLATE[key], enabled: false };
          }
          for (const rule of rules) {
            const dayKey = dayMap[rule.day_of_week];
            if (dayKey) {
              template[dayKey] = {
                enabled: rule.is_active,
                start: rule.start_time,
                end: rule.end_time,
              };
            }
          }
          setWeeklyTemplate(template);
        }
      }
    } catch {
      // silently fail — use defaults
    }
  }, []);

  const fetchOverrides = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/scheduling/overrides");
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setOverrides(
            json.data.map((item: Record<string, unknown>) => ({
              id: item.id as string,
              date: item.target_date as string,
              type: item.override_type as "block" | "custom",
              start: (item.start_time as string) ?? undefined,
              end: (item.end_time as string) ?? undefined,
              label: (item.label as string) ?? undefined,
            })),
          );
        }
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchAvailabilityRules(), fetchOverrides()]).finally(() =>
      setAvailabilityLoading(false),
    );
  }, [fetchAvailabilityRules, fetchOverrides]);

  async function handleSaveAvailability() {
    setAvailabilitySaving(true);
    try {
      const dayIndexMap: Record<DayOfWeek, number> = {
        sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      };
      const rules = DAY_KEYS
        .filter((day) => weeklyTemplate[day].enabled)
        .map((day) => ({
          day_of_week: dayIndexMap[day],
          start_time: weeklyTemplate[day].start,
          end_time: weeklyTemplate[day].end,
          is_active: true,
        }));
      const res = await fetch("/api/v1/scheduling/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "保存に失敗しました");
      }
      toast.success("空き時間の設定を保存しました");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "空き時間の保存に失敗しました";
      toast.error(message);
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function handleAddOverride() {
    if (!newOverrideDate) {
      toast.error("日付を選択してください");
      return;
    }
    setAddingOverride(true);
    try {
      const body: Record<string, string> = {
        target_date: newOverrideDate,
        override_type: newOverrideType,
      };
      if (newOverrideType === "custom") {
        body.start_time = newOverrideStart;
        body.end_time = newOverrideEnd;
      }
      const res = await fetch("/api/v1/scheduling/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "追加に失敗しました");
      }
      toast.success("除外日を追加しました");
      setShowAddOverride(false);
      setNewOverrideDate("");
      setNewOverrideType("block");
      await fetchOverrides();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "除外日の追加に失敗しました";
      toast.error(message);
    } finally {
      setAddingOverride(false);
    }
  }

  async function handleDeleteOverride(id: string) {
    try {
      const res = await fetch(`/api/v1/scheduling/overrides/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "削除に失敗しました");
      }
      toast.success("除外日を削除しました");
      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "除外日の削除に失敗しました";
      toast.error(message);
    }
  }

  function updateDayRule(day: DayOfWeek, field: keyof DayRule, value: boolean | string) {
    setWeeklyTemplate((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  }

  const fetchCalendarStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("calendar_connections")
        .select("id, provider, provider_email, last_synced_at, is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setCalendarConnection(data);
    } catch {
      // silently fail — user just sees "not connected"
    } finally {
      setCalendarLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchCalendarStatus();
  }, [fetchCalendarStatus]);

  async function handleCalendarConnect() {
    setCalendarConnecting(true);
    try {
      const res = await fetch("/api/v1/calendar/connect", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "接続に失敗しました");
      }
      if (json.data?.url) {
        window.location.href = json.data.url;
        return; // redirect — don't reset loading
      }
      toast.error("リダイレクトURLが取得できませんでした");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "カレンダー接続に失敗しました";
      toast.error(message);
    } finally {
      setCalendarConnecting(false);
    }
  }

  async function handleMicrosoftConnect() {
    setMicrosoftConnecting(true);
    try {
      const res = await fetch("/api/v1/calendar/microsoft/connect", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "接続に失敗しました");
      }
      if (json.data?.url) {
        window.location.href = json.data.url;
        return; // redirect — don't reset loading
      }
      toast.error("リダイレクトURLが取得できませんでした");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "カレンダー接続に失敗しました";
      toast.error(message);
    } finally {
      setMicrosoftConnecting(false);
    }
  }

  async function handleIcsSubscribe() {
    const trimmed = icsUrl.trim();
    if (!trimmed) {
      toast.error("ICS URLを入力してください");
      return;
    }
    setIcsSubmitting(true);
    try {
      const res = await fetch("/api/v1/calendar/ics/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ics_url: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "ICS接続に失敗しました");
      }
      toast.success("ICSカレンダーを接続しました");
      setIcsUrl("");
      setIcsExpanded(false);
      await fetchCalendarStatus();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "ICS接続に失敗しました";
      toast.error(message);
    } finally {
      setIcsSubmitting(false);
    }
  }

  const fetchFeedUrl = useCallback(async () => {
    setFeedLoading(true);
    try {
      const res = await fetch("/api/v1/calendar/feed-token");
      if (res.ok) {
        const json = await res.json();
        if (json.data?.token) {
          const origin = window.location.origin;
          setFeedUrl(`${origin}/api/v1/calendar/feed/${json.data.token}`);
        }
      }
    } catch {
      // silently fail
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedUrl();
  }, [fetchFeedUrl]);

  async function handleCopyFeedUrl() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setFeedCopied(true);
      toast.success("フィードURLをコピーしました");
      setTimeout(() => setFeedCopied(false), 2000);
    } catch {
      toast.error("コピーに失敗しました");
    }
  }

  async function handleCalendarSync() {
    if (!calendarConnection) return;
    setCalendarSyncing(true);
    try {
      const res = await fetch("/api/v1/calendar/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "同期に失敗しました");
      }
      toast.success("カレンダーを同期しました");
      await fetchCalendarStatus();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "カレンダー同期に失敗しました";
      toast.error(message);
    } finally {
      setCalendarSyncing(false);
    }
  }

  async function handleCalendarDisconnect() {
    if (!calendarConnection) return;
    setCalendarDisconnecting(true);
    try {
      const res = await fetch(
        `/api/v1/calendar/disconnect?id=${calendarConnection.id}`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? "切断に失敗しました");
      }
      toast.success("カレンダー連携を解除しました");
      setCalendarConnection(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "カレンダー切断に失敗しました";
      toast.error(message);
    } finally {
      setCalendarDisconnecting(false);
    }
  }

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
    // 現パスワード必須化 (Sec Critical: セッション奪取で即書換可能だった旧仕様の解消)
    // GitHub / Stripe / Google 等の業界標準: 現パスでの再認証 → 新パス更新
    if (!currentPassword) {
      toast.error("現在のパスワードを入力してください");
      return;
    }
    if (!newPassword) {
      toast.error("新しいパスワードを入力してください");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("パスワードは 8 文字以上で入力してください");
      return;
    }
    if (newPassword === currentPassword) {
      toast.error("新しいパスワードは現在と異なるものを設定してください");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("パスワードが一致しません");
      return;
    }
    if (!user?.email) {
      toast.error("ユーザー情報が取得できません");
      return;
    }

    setPasswordLoading(true);
    try {
      // 1) 現パスワードで再認証 (signInWithPassword で検証、失敗時は 401)
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthErr) {
        toast.error("現在のパスワードが正しくありません");
        return;
      }
      // 2) 新パスワード更新
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      toast.success("パスワードを変更しました");
      setPasswordDialogOpen(false);
      setCurrentPassword("");
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
          <CardTitle className="flex items-center gap-2 text-base">
            <SectionIcon name="account" />
            アカウント
          </CardTitle>
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
                    安全のため、現在のパスワードでの再認証が必要です。新しいパスワードは 8 文字以上で設定してください。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="current-password">現在のパスワード</Label>
                    <Input
                      id="current-password"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password">新しいパスワード</Label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="8 文字以上"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password">新しいパスワード (確認)</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPasswordDialogOpen(false);
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                    }}
                    disabled={passwordLoading}
                  >
                    キャンセル
                  </Button>
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
            <SectionIcon name="notifications" />
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

      {/* Subscription / Billing (00064) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-5 w-5" />
            プラン / 課金
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {subLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">読み込み中...</span>
            </div>
          ) : subData?.subscription?.status === "active" ||
            subData?.subscription?.status === "trialing" ? (
            <>
              <p className="text-emerald-700 dark:text-emerald-300">
                Standard プラン{" "}
                {subData?.subscription?.status === "trialing"
                  ? "(トライアル中)"
                  : "(有効)"}
              </p>
              {subData?.subscription?.cancel_at_period_end && (
                <p className="text-xs text-orange-700 dark:text-orange-300">
                  期間終了時に解約されます
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handlePortal}
                disabled={billingLoading}
                aria-busy={billingLoading}
              >
                {billingLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    遷移中
                  </>
                ) : (
                  "プランを管理 (Stripe)"
                )}
              </Button>
            </>
          ) : subData?.subscription?.status === "past_due" ||
            subData?.subscription?.status === "unpaid" ? (
            <>
              <p className="text-orange-700 dark:text-orange-300">
                お支払いに問題があります。支払い情報を更新してください。
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handlePortal}
                disabled={billingLoading}
                aria-busy={billingLoading}
              >
                {billingLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    遷移中
                  </>
                ) : (
                  "支払い情報を更新"
                )}
              </Button>
            </>
          ) : subData?.subscription?.status === "canceled" ? (
            <>
              <p className="text-muted-foreground">
                プランは解約済みです。
              </p>
              <Button
                size="sm"
                onClick={handleSubscribe}
                disabled={billingLoading}
                aria-busy={billingLoading}
              >
                {billingLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    遷移中
                  </>
                ) : (
                  "プランに再申し込み"
                )}
              </Button>
            </>
          ) : subData?.subscription?.status === "incomplete" ? (
            <>
              <p className="text-orange-700 dark:text-orange-300">
                決済が未完了です。お支払いを完了してください。
              </p>
              <Button
                size="sm"
                onClick={handlePortal}
                disabled={billingLoading}
                aria-busy={billingLoading}
              >
                {billingLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    遷移中
                  </>
                ) : (
                  "決済を完了する"
                )}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Standard プラン ¥30,000/月
                でマッチング/AI 推薦/コネクション機能をフル活用できます。
              </p>
              <Button
                size="sm"
                onClick={handleSubscribe}
                disabled={billingLoading}
                aria-busy={billingLoading}
              >
                {billingLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    遷移中
                  </>
                ) : (
                  "プランに申し込む"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* AI Profile link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SectionIcon name="ai-profile" />
            AIプロフィール管理
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analysisLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">読み込み中...</span>
            </div>
          ) : (
          <>
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
          </>
          )}
        </CardContent>
      </Card>

      {/* 代理店プログラム (00063) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Handshake className="h-5 w-5" />
            代理店プログラム
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {agencyMeLoading || agencyAppLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">読み込み中...</span>
            </div>
          ) : agencyMe?.agency?.status === "approved" ? (
            <>
              <p className="text-emerald-700 dark:text-emerald-300">
                承認済み代理店として有効です。
              </p>
              <Button size="sm" variant="outline" render={<Link href="/agency" />}>
                代理店ダッシュボードへ
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </>
          ) : agencyMe?.agency?.status === "suspended" ? (
            <p className="text-orange-700 dark:text-orange-300">
              代理店資格は現在停止されています。サポートまでお問い合わせください。
            </p>
          ) : agencyApp?.application?.status === "pending" ? (
            <p className="text-muted-foreground">
              申請を受け付けました。承認をお待ちください。
            </p>
          ) : agencyApp?.application?.status === "rejected" ? (
            <>
              <p className="text-muted-foreground">
                前回の申請は却下されました
                {agencyApp?.application?.admin_note
                  ? ` (理由: ${agencyApp?.application?.admin_note})`
                  : ""}
                。
              </p>
              <Button size="sm" onClick={() => setAgencyApplyOpen(true)}>
                再申請する
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                紹介リンクを発行し、新規ユーザー獲得時にコミッションを受け取れる
                代理店プログラムに申請できます。無料会員でも申請可能です。
              </p>
              <Button size="sm" onClick={() => setAgencyApplyOpen(true)}>
                代理店として申請する
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={agencyApplyOpen} onOpenChange={setAgencyApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>代理店プログラム申請</DialogTitle>
            <DialogDescription>
              申請理由を任意で記入してください (5-2000字、空欄でも可)。
              承認後、紹介リンクの発行と紹介管理が可能になります。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="agency-applicant-note">申請理由 (任意)</Label>
            <textarea
              id="agency-applicant-note"
              value={applicantNote}
              onChange={(e) => setApplicantNote(e.target.value)}
              placeholder="例: 経営者コミュニティを運営しており、メンバーに紹介したい"
              maxLength={2000}
              rows={5}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            />
            <p className="text-right text-xs text-muted-foreground">
              {applicantNote.length} / 2000
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgencyApplyOpen(false)}>
              キャンセル
            </Button>
            <Button
              disabled={applyAgency.isPending}
              aria-busy={applyAgency.isPending}
              onClick={async () => {
                const note = applicantNote.trim();
                await applyAgency.mutateAsync({
                  applicant_note: note.length >= 5 ? note : undefined,
                });
                setAgencyApplyOpen(false);
                setApplicantNote("");
              }}
            >
              {applyAgency.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  送信中
                </>
              ) : (
                "申請する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* tl;dv connection
        * 注: tl;dv API は 単一テナント (TLDV_API_KEY env) で動作する。
        * ユーザー個別の API key 入力 UI は出さない。
        * 接続判定は user_conversation_vectors.analysis_count > 0 を proxy にする。
        * webhook (TranscriptReady) は tl;dv 側で設定済みなので、
        * 「次の会議が tl;dv で記録されると自動で再分析」が期待値になる。
        */}
      <Card id="tldv-connect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SectionIcon name="tldv" />
            ミーティング分析 (tl;dv 連携)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analysisLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">読み込み中...</span>
            </div>
          ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Video className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">tl;dv 連携</p>
                  {hasAnalyses ? (
                    <Badge variant="secondary">接続済み</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      未接続
                    </Badge>
                  )}
                </div>
                {hasAnalyses ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {analysisCount}件のミーティングを分析済み
                    </p>
                    {lastAnalyzedAt && (
                      <p className="text-xs text-muted-foreground">
                        最終分析:{" "}
                        {new Date(
                          lastAnalyzedAt,
                        ).toLocaleString("ja-JP")}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {hasAnalyses
                  ? "次のミーティングが tl;dv に記録されると自動で再分析され、AI推薦の精度が上がります。"
                  : "tl;dvのミーティング記録を接続すると、あなたの関心や専門領域をAIが分析し、本当に会うべき人をご紹介できます。次回以降の tl;dv 録画が自動で取り込まれます。"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setTldvSyncing(true);
                  try {
                    const result = await api.post<{
                      processed: number;
                      skipped: number;
                      errors: number;
                      total: number;
                    }>("/transcripts/sync");
                    if (result.processed > 0) {
                      toast.success(
                        `${result.processed}件のミーティングを取り込みました`,
                      );
                    } else if (result.skipped > 0) {
                      toast.info(
                        `${result.skipped}件は処理済みでした`,
                      );
                    } else {
                      toast.info("新しいミーティングはありませんでした");
                    }
                    // プロフィールのanalysis_countを再取得してUIを更新
                    void queryClient.invalidateQueries({ queryKey: queryKeys.profile.me() });
                  } catch (err: unknown) {
                    const message =
                      err instanceof Error
                        ? err.message
                        : "同期に失敗しました";
                    toast.error(message);
                  } finally {
                    setTldvSyncing(false);
                  }
                }}
                disabled={tldvSyncing}
              >
                {tldvSyncing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                {tldvSyncing ? "同期中..." : "今すぐ同期"}
              </Button>
              {hasAnalyses && (
                <Button
                  size="sm"
                  variant="ghost"
                  render={<Link href="/settings/ai-profile" />}
                >
                  分析結果を見る
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Calendar connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SectionIcon name="calendar" />
            カレンダー連携
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                {calendarLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      読み込み中...
                    </span>
                  </div>
                ) : calendarConnection ? (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {calendarConnection.provider === "microsoft"
                          ? "Outlook カレンダー"
                          : calendarConnection.provider === "ics_feed"
                            ? "ICS カレンダー"
                            : "Google カレンダー"}
                      </p>
                      <Badge variant="secondary">接続済み</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {calendarConnection.provider_email}
                    </p>
                    {calendarConnection.last_synced_at && (
                      <p className="text-xs text-muted-foreground">
                        最終同期:{" "}
                        {new Date(
                          calendarConnection.last_synced_at,
                        ).toLocaleString("ja-JP")}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">カレンダー</p>
                      <span className="text-xs text-muted-foreground">
                        未接続
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {!calendarLoading && !calendarConnection && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                GoogleカレンダーまたはOutlookカレンダーを接続すると、会議スケジュールの自動同期や空き時間の確認ができます。
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {calendarConnection ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCalendarSync}
                    disabled={calendarSyncing}
                  >
                    {calendarSyncing ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {calendarSyncing ? "同期中..." : "同期"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCalendarDisconnect}
                    disabled={calendarDisconnecting}
                  >
                    {calendarDisconnecting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unlink className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {calendarDisconnecting ? "切断中..." : "切断"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={handleCalendarConnect}
                    disabled={calendarConnecting || microsoftConnecting || calendarLoading}
                  >
                    {calendarConnecting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Calendar className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {calendarConnecting
                      ? "接続中..."
                      : "Googleカレンダーを接続"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleMicrosoftConnect}
                    disabled={microsoftConnecting || calendarConnecting || calendarLoading}
                  >
                    {microsoftConnecting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Calendar className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {microsoftConnecting
                      ? "接続中..."
                      : "Outlookカレンダーを接続"}
                  </Button>
                </>
              )}
            </div>

            {/* ICS URL subscription */}
            {!calendarLoading && !calendarConnection && (
              <div className="border-t pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex-1 border-t" />
                  <span>または</span>
                  <span className="flex-1 border-t" />
                </div>
                <button
                  type="button"
                  className="mt-2 flex w-full items-center justify-between text-sm font-medium"
                  onClick={() => setIcsExpanded((v) => !v)}
                >
                  <span>ICS URLで接続（その他のカレンダー）</span>
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${icsExpanded ? "rotate-90" : ""}`}
                  />
                </button>
                {icsExpanded && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Google Calendar、Apple Calendar、Outlook等からICS URLを取得して貼り付けてください
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="url"
                        placeholder="https://calendar.google.com/calendar/ical/..."
                        value={icsUrl}
                        onChange={(e) => setIcsUrl(e.target.value)}
                        className="h-11 flex-1 text-base md:text-xs"
                      />
                      <Button
                        size="sm"
                        onClick={handleIcsSubscribe}
                        disabled={icsSubmitting || !icsUrl.trim()}
                      >
                        {icsSubmitting ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {icsSubmitting ? "接続中..." : "接続"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Calendar feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SectionIcon name="ics-feed" />
            カレンダーフィード
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              このURLを外部カレンダーアプリ（Google Calendar、Apple Calendar等）に登録すると、
              INTERCONNECTの会議予定が自動的に同期されます。
            </p>
            {feedLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">読み込み中...</span>
              </div>
            ) : feedUrl ? (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={feedUrl}
                  className="h-11 flex-1 text-base md:text-xs font-mono"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyFeedUrl}
                  className="shrink-0"
                >
                  {feedCopied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {feedCopied ? "コピー済み" : "コピー"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setFeedLoading(true);
                    try {
                      const res = await fetch("/api/v1/calendar/feed-token", {
                        method: "POST",
                      });
                      if (res.ok) {
                        const json = await res.json();
                        if (json.data?.token) {
                          const origin = window.location.origin;
                          setFeedUrl(
                            `${origin}/api/v1/calendar/feed/${json.data.token}`,
                          );
                          toast.success("フィードURLを発行しました");
                        }
                      }
                    } catch {
                      toast.error("発行に失敗しました");
                    } finally {
                      setFeedLoading(false);
                    }
                  }}
                >
                  フィードURLを発行
                </Button>
                <p className="text-xs text-muted-foreground">
                  「発行」を押すと購読 URL が払い出されます。再発行で旧 URL は失効します。
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              このURLは秘密情報です。他の人と共有しないでください。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Availability settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SectionIcon name="availability" />
            空き時間の設定
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              普段の空き時間パターンを設定すると、日程調整の候補が自動で生成されます。
            </p>

            {availabilityLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">読み込み中...</span>
              </div>
            ) : (
              <>
                {/* Weekly template — SP では時刻 select 群が右にはみ出すため flex-wrap で折返し許可 */}
                <div className="space-y-2">
                  {DAY_KEYS.map((day) => (
                    <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="w-6 text-sm font-medium">{DAY_LABELS[day]}</span>
                      <Checkbox
                        checked={weeklyTemplate[day].enabled}
                        onCheckedChange={(checked) =>
                          updateDayRule(day, "enabled", checked)
                        }
                      />
                      {weeklyTemplate[day].enabled ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            value={weeklyTemplate[day].start}
                            onChange={(e) => updateDayRule(day, "start", e.target.value)}
                            className="h-11 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                          >
                            {TIME_OPTIONS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <span className="text-xs text-muted-foreground">〜</span>
                          <select
                            value={weeklyTemplate[day].end}
                            onChange={(e) => updateDayRule(day, "end", e.target.value)}
                            className="h-11 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                          >
                            {TIME_OPTIONS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">休み</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Save button */}
                <Button
                  size="sm"
                  onClick={handleSaveAvailability}
                  disabled={availabilitySaving}
                >
                  {availabilitySaving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {availabilitySaving ? "保存中..." : "保存"}
                </Button>

                {/* Overrides */}
                <div className="border-t pt-4">
                  <Label className="text-xs font-medium">除外日</Label>
                  {overrides.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {overrides.map((o) => {
                        const d = new Date(o.date + "T00:00:00");
                        const dayName = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
                        return (
                          <div key={o.id} className="flex items-center justify-between text-sm">
                            <span>
                              {o.date} ({dayName}){" "}
                              {o.type === "block"
                                ? "終日ブロック"
                                : `${o.start}〜${o.end}`}
                              {o.label ? ` ${o.label}` : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteOverride(o.id)}
                              aria-label={`${o.date} の除外日を削除`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      除外日はまだ設定されていません
                    </p>
                  )}

                  {showAddOverride ? (
                    <div className="mt-3 space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">日付</Label>
                          <Input
                            type="date"
                            value={newOverrideDate}
                            onChange={(e) => setNewOverrideDate(e.target.value)}
                            className="h-11 w-auto text-base md:text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">タイプ</Label>
                          <select
                            value={newOverrideType}
                            onChange={(e) => setNewOverrideType(e.target.value as "block" | "custom")}
                            className="h-11 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                          >
                            <option value="block">終日ブロック</option>
                            <option value="custom">カスタム時間</option>
                          </select>
                        </div>
                        {newOverrideType === "custom" && (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs">開始</Label>
                              <select
                                value={newOverrideStart}
                                onChange={(e) => setNewOverrideStart(e.target.value)}
                                className="h-11 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                              >
                                {TIME_OPTIONS.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">終了</Label>
                              <select
                                value={newOverrideEnd}
                                onChange={(e) => setNewOverrideEnd(e.target.value)}
                                className="h-11 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                              >
                                {TIME_OPTIONS.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleAddOverride}
                          disabled={addingOverride}
                        >
                          {addingOverride ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {addingOverride ? "追加中..." : "追加"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowAddOverride(false)}
                        >
                          キャンセル
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setShowAddOverride(true)}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      除外日を追加
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <SectionIcon name="danger" />
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
