"use client";

/**
 * /admin/users/[id]
 *
 * ユーザー詳細 (admin only)。閲覧理由ダイアログ → 取得 → タブ表示。
 * reason は session storage に id 単位で保持 (TTL 30 min) して再入力ループを防ぐ。
 */

import { useState, useEffect, use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft, Loader2, ShieldCheck, AlertTriangle, Info, Briefcase, Globe, Shield,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";

interface UserDetail {
  profile: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    position: string | null;
    industry: string | null;
    bio: string | null;
    avatar_url: string | null;
    is_admin: boolean;
    is_active: boolean;
    is_agency: boolean;
    onboarding_step: number | null;
    manual_plan: "monitor" | "free" | null;
    prospect_invite_at: string | null;
    created_at: string;
    updated_at: string | null;
  };
  subscription: {
    status: string | null;
    current_period_end: string | null;
  } | null;
  counts: { connections: number; meetings: number };
  goals: Array<{ type: string; detail: string | null; created_at: string }>;
  offerings: Array<{ type: string; detail: string | null; created_at: string }>;
  recent_audit: Array<{
    id: string;
    actor_id: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  login_sessions: Array<{
    id: string;
    ip_address: string | null;
    user_agent: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    referrer: string | null;
    created_at: string;
  }>;
}

const REASON_TTL_MS = 30 * 60 * 1000;

function loadReason(id: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`admin-view-reason:${id}`);
    if (!raw) return null;
    const { reason, ts } = JSON.parse(raw) as { reason: string; ts: number };
    if (Date.now() - ts > REASON_TTL_MS) {
      sessionStorage.removeItem(`admin-view-reason:${id}`);
      return null;
    }
    return reason;
  } catch {
    return null;
  }
}

function saveReason(id: string, reason: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    `admin-view-reason:${id}`,
    JSON.stringify({ reason, ts: Date.now() }),
  );
}

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [reason, setReason] = useState<string | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    // sessionStorage から hydrate (initial mount 時 1 回のみ、cascading render なし)
    const cached = loadReason(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached) setReason(cached);
  }, [id]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-user-detail", id, reason],
    queryFn: () =>
      // reason はヘッダ経由で送信 (URL 履歴 / Referer leak 回避)
      api.getWithHeaders<UserDetail>(`/admin/users/${id}`, {
        "X-Admin-Reason": encodeURIComponent(reason!),
      }),
    enabled: Boolean(reason),
  });

  // 代理店バッジ付与/解除 (PATCH → audit_logs に admin.user.grant_agency_badge を残す)
  const [agencyLoading, setAgencyLoading] = useState(false);
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [downgradeDialogOpen, setDowngradeDialogOpen] = useState(false);
  const [sessionPassword, setSessionPassword] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionData, setSessionData] = useState<UserDetail["login_sessions"] | null>(null);
  async function toggleAgencyBadge() {
    if (!data) return;
    const grant = !data.profile.is_agency;
    setAgencyLoading(true);
    try {
      await api.patch<{ id: string; is_agency: boolean }>(
        `/admin/users/${id}/agency-badge`,
        { grant },
      );
      toast.success(grant ? "代理店バッジを付与しました" : "代理店バッジを解除しました");
      await refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "更新に失敗しました。少し待ってから再試行してください。";
      toast.error(msg);
    } finally {
      setAgencyLoading(false);
    }
  }

  async function confirmDowngradeToFree() {
    if (!data) return;
    if (data.profile.manual_plan !== "monitor") return;
    setDowngradeLoading(true);
    try {
      const res = await api.patch<{ id: string; manual_plan: string; email_status: string }>(
        `/admin/users/${id}/downgrade-plan`,
        {},
      );
      const emailMsg =
        res.email_status === "sent"
          ? "メール送信済"
          : res.email_status === "fallback"
            ? "メール未送信 (RESEND_API_KEY 未設定 / log 出力)"
            : "メール送信失敗 (DB 更新は完了)";
      toast.success(`無料会員にダウングレードしました (${emailMsg})`);
      setDowngradeDialogOpen(false);
      await refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : "ダウングレードに失敗しました。少し待ってから再試行してください。";
      toast.error(msg);
    } finally {
      setDowngradeLoading(false);
    }
  }

  function submitReason() {
    const trimmed = reasonInput.trim();
    if (trimmed.length < 5) {
      setReasonError("5 文字以上で理由を入力してください");
      return;
    }
    if (trimmed.length > 500) {
      setReasonError("500 文字以内で入力してください");
      return;
    }
    saveReason(id, trimmed);
    setReason(trimmed);
    setReasonError(null);
  }

  // reason ダイアログ表示
  if (!reason) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
            ADMIN
          </p>
          <h1 className="mt-1 text-xl font-bold">閲覧理由の入力</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            個人情報を閲覧するため、理由を記録します (5-500 字)。
            記録は監査ログに残り、本人開示請求の対象となります。
          </p>
          <label htmlFor="reason" className="mt-4 block text-xs font-medium">
            閲覧理由
          </label>
          <textarea
            id="reason"
            value={reasonInput}
            onChange={(e) => {
              setReasonInput(e.target.value);
              if (reasonError) setReasonError(null);
            }}
            placeholder="例: 本人からのお問い合わせ #1234 対応のため"
            rows={4}
            maxLength={500}
            className="mt-1 w-full resize-none rounded-md border bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 sm:text-sm"
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? "reason-err" : undefined}
          />
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{reasonInput.length} / 500</span>
            {reasonError && (
              <span id="reason-err" className="text-destructive">
                {reasonError}
              </span>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" render={<Link href="/admin/users" />}>
              キャンセル
            </Button>
            <Button size="sm" onClick={submitReason}>
              閲覧する
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          ユーザー一覧に戻る
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error instanceof ApiError && error.code === "REASON_REQUIRED"
            ? "閲覧理由が無効です。再入力してください。"
            : error instanceof ApiError && error.code === "AUDIT_FAILED"
              ? "閲覧記録の保存に失敗したため詳細を表示できません。少し時間をおいてから再試行してください (連続失敗時は運営に連絡してください)。"
              : error instanceof ApiError && error.code === "FORBIDDEN"
                ? "admin 権限が確認できません。再ログインを試してください。"
                : `読み込みに失敗しました。[${error instanceof ApiError ? `${error.status} ${error.code}: ${error.message}` : String(error)}]`}
        </div>
      )}

      {data && (
        <>
          <header className="mb-6">
            <p className="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
              ADMIN / USER DETAIL
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{data.profile.name}</h1>
              {data.profile.is_admin && (
                <Badge
                  variant="outline"
                  className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                >
                  <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                  admin
                </Badge>
              )}
              {!data.profile.is_active && <Badge variant="destructive">停止中</Badge>}
              {data.profile.is_agency && (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                >
                  <Briefcase className="mr-1 h-3 w-3" aria-hidden="true" />
                  代理店
                </Badge>
              )}
              {(data.profile.onboarding_step ?? 0) < 3 && (
                <Badge variant="secondary">オンボ未完了</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.profile.email ?? "(no email)"} · {data.profile.company ?? "—"}
              {data.profile.position && ` / ${data.profile.position}`}
            </p>
          </header>

          {/* Overview セクション */}
          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="接続数" value={data.counts.connections} />
            <StatCard label="参加会議" value={data.counts.meetings} />
            <StatCard
              label="目的 / 提供"
              value={`${data.goals.length} / ${data.offerings.length}`}
            />
          </section>

          {/* Profile / Bio */}
          <section className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold">プロフィール</h2>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <DescItem label="業界" value={data.profile.industry} />
              <DescItem
                label="登録日"
                value={new Date(data.profile.created_at).toLocaleString("ja-JP")}
              />
              <DescItem
                label="自己紹介"
                value={data.profile.bio}
                fullWidth
              />
            </dl>
            {!data.profile.bio && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                自己紹介が未入力です
              </p>
            )}
          </section>

          {/* 管理アクション — 代理店バッジ付与/解除 */}
          <section className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold">管理アクション</h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">代理店バッジ</p>
                <p className="text-xs text-muted-foreground">
                  付与すると member 一覧・マッチング・プロフィール等に「代理店」バッジが表示されます。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={data.profile.is_agency ? "outline" : "default"}
                onClick={toggleAgencyBadge}
                disabled={agencyLoading}
                aria-busy={agencyLoading}
              >
                {agencyLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                {data.profile.is_agency ? "バッジを解除" : "バッジを付与"}
              </Button>
            </div>
          </section>

          {/* プラン管理 — モニター → 無料 ダウングレード */}
          <section className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold">プラン管理</h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">
                  現在のプラン:{" "}
                  <span className="font-normal">
                    {data.profile.manual_plan === "monitor"
                      ? "モニター会員 (有料相当)"
                      : data.profile.manual_plan === "free"
                        ? "無料会員 (運営付与)"
                        : data.subscription?.status === "active" ||
                            data.subscription?.status === "trialing"
                          ? "有料会員 (Stripe)"
                          : "無料会員 (Stripe基準)"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  モニター → 無料 に変更すると本人にダウングレード通知メールが送信されます。
                </p>
              </div>
              {data.profile.manual_plan === "monitor" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDowngradeDialogOpen(true)}
                  disabled={downgradeLoading}
                  aria-busy={downgradeLoading}
                >
                  {downgradeLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  )}
                  無料にダウングレード
                </Button>
              )}
            </div>
          </section>

          {/* ダウングレード確認 Dialog (window.confirm のサイト内置換) */}
          <Dialog
            open={downgradeDialogOpen}
            onOpenChange={(open: boolean) => {
              if (!downgradeLoading) setDowngradeDialogOpen(open);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>モニター → 無料 にダウングレード</DialogTitle>
                <DialogDescription>
                  <span className="block">
                    <strong>{data.profile.name}</strong> さんをモニター会員から無料会員に変更します。
                  </span>
                  <span className="mt-2 block">
                    本人に <code>{data.profile.email}</code> 宛でダウングレード通知メールが送信されます。
                  </span>
                  <span className="mt-2 block text-amber-700 dark:text-amber-300">
                    無料会員への変更後、有料機能の一部はご利用いただけなくなります。
                  </span>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDowngradeDialogOpen(false)}
                  disabled={downgradeLoading}
                >
                  キャンセル
                </Button>
                <Button
                  type="button"
                  onClick={confirmDowngradeToFree}
                  disabled={downgradeLoading}
                  aria-busy={downgradeLoading}
                >
                  {downgradeLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  )}
                  無料にダウングレード
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Goals / Offerings */}
          <section className="mb-6 grid gap-3 md:grid-cols-2">
            <CardList title="求めていること" items={data.goals} emptyText="未登録" />
            <CardList title="提供できること" items={data.offerings} emptyText="未登録" />
          </section>

          {/* Login Sessions — パスワード再認証ゲート */}
          <section className="mb-6 rounded-lg border bg-card shadow-sm">
            <h2 className="border-b px-4 py-3 text-sm font-bold flex items-center gap-1.5">
              <Shield className="h-4 w-4" aria-hidden="true" />
              ログイン履歴 (最新 50 件)
            </h2>
            {!sessionData ? (
              <div className="px-4 py-6 space-y-3">
                <p className="text-xs text-muted-foreground">
                  個人情報に準ずるデータです。パスワードを再入力してください。すべてのアクセスは監査ログに記録されます。
                </p>
                <div>
                  <Label htmlFor="session-password">パスワード再入力</Label>
                  <Input
                    id="session-password"
                    type="password"
                    value={sessionPassword}
                    onChange={(e) => setSessionPassword(e.target.value)}
                    placeholder="ログインパスワード"
                    autoComplete="new-password"
                    className="mt-1 max-w-sm"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={sessionLoading || !sessionPassword}
                  aria-busy={sessionLoading}
                  onClick={async () => {
                    setSessionLoading(true);
                    try {
                      const result = await api.post<{ login_sessions: UserDetail["login_sessions"] }>(
                        `/admin/users/${id}/login-sessions`,
                        { password: sessionPassword },
                        { headers: { "X-Admin-Reason": encodeURIComponent(reason!) } },
                      );
                      setSessionData(result.login_sessions);
                      setSessionPassword("");
                    } catch (e) {
                      if (e instanceof ApiError) {
                        toast.error(e.message);
                      } else {
                        toast.error("取得に失敗しました");
                      }
                    } finally {
                      setSessionLoading(false);
                    }
                  }}
                >
                  {sessionLoading ? (
                    <>
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      検証中
                    </>
                  ) : (
                    <>
                      <Shield className="mr-1 h-3.5 w-3.5" />
                      ログイン履歴を表示
                    </>
                  )}
                </Button>
              </div>
            ) : sessionData.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                <Info className="mx-auto mb-2 h-4 w-4" aria-hidden="true" />
                ログイン記録がありません
              </p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">日時</th>
                        <th className="px-4 py-2 text-left font-medium">IP</th>
                        <th className="px-4 py-2 text-left font-medium">端末 / OS</th>
                        <th className="px-4 py-2 text-left font-medium">ブラウザ</th>
                        <th className="px-4 py-2 text-left font-medium">リファラー</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sessionData.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/20">
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                            {new Date(s.created_at).toLocaleString("ja-JP")}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                            {s.ip_address ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-xs">
                            {[s.device, s.os].filter(Boolean).join(" / ") || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-xs">
                            {s.browser ?? "—"}
                          </td>
                          <td className="max-w-[200px] truncate px-4 py-2 text-xs text-muted-foreground" title={s.referrer ?? undefined}>
                            {s.referrer ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y md:hidden list-none p-0">
                  {sessionData.map((s) => (
                    <li key={s.id} className="px-4 py-3 space-y-1">
                      <p className="font-mono text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("ja-JP")}
                      </p>
                      <p className="font-mono text-xs">IP: {s.ip_address ?? "—"}</p>
                      <p className="text-xs">
                        {[s.device, s.os, s.browser].filter(Boolean).join(" / ") || "—"}
                      </p>
                      {s.referrer && (
                        <p className="text-xs text-muted-foreground truncate">
                          Ref: {s.referrer}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Audit Trail */}
          <section className="rounded-lg border bg-card shadow-sm">
            <h2 className="border-b px-4 py-3 text-sm font-bold">監査ログ (最新 20 件)</h2>
            {data.recent_audit.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                <Info className="mx-auto mb-2 h-4 w-4" aria-hidden="true" />
                記録がありません
              </p>
            ) : (
              <ul className="divide-y list-none p-0">
                {data.recent_audit.map((log) => (
                  <li key={log.id} className="px-4 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("ja-JP")}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {log.action}
                      </code>
                      {log.target_type && (
                        <span className="text-xs text-muted-foreground">
                          → {log.target_type}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function DescItem({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string | null;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm">{value ?? "—"}</dd>
    </div>
  );
}

function CardList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ type: string; detail: string | null }>;
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-bold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5 list-none p-0">
          {items.map((g, i) => (
            <li key={`${g.type}-${i}`} className="text-sm">
              <Badge variant="secondary" className="mr-1 text-xs">
                {g.type}
              </Badge>
              {g.detail && (
                <span className="text-xs text-muted-foreground">{g.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
