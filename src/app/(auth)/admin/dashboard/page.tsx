"use client";

/**
 * /admin/dashboard
 *
 * 運営 top hub. KPI 12 枚を 1 画面で把握する。
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users, UserCheck, Heart, Inbox, AlertTriangle,
  TrendingUp, FileWarning, ChevronRight, Loader2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import type { LucideIcon } from "lucide-react";

interface DashboardKpi {
  active_users_total: number;
  dau_24h: number;
  wau_7d: number;
  mau_30d: number;
  onboarding_completed: number;
  onboarding_in_progress: number;
  connections_accepted_total: number;
  connections_pending: number;
  matches_total: number;
  pending_import_requests: number;
  processing_import_requests: number;
  transcript_errors: number;
  incomplete_profiles: number;
  participants_linked_7d: number;
}

interface KpiCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "default" | "warn" | "success";
}

function KpiCard({ label, value, hint, icon: Icon, href, tone = "default" }: KpiCardProps) {
  const toneClass =
    tone === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      : tone === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
        : "border-border bg-card";

  const inner = (
    <div className={`flex min-h-[120px] flex-col justify-between rounded-lg border p-4 shadow-sm transition-colors ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {href && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          詳細を開く <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </p>
      )}
    </div>
  );

  return href ? (
    <Link
      href={href}
      aria-label={`${label} ${typeof value === "number" ? value.toLocaleString() : value} の詳細を開く`}
      className="block rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default function AdminDashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get<DashboardKpi>("/admin/dashboard"),
    // tab が hidden / 非アクティブの間は polling を止める
    // (旧 60s 固定 polling は admin が放置中にも RPC 課金を発生させていた)
    refetchInterval: (q) =>
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? 60_000
        : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
          ADMIN
        </p>
        <h1 className="mt-1 text-2xl font-bold">運営ダッシュボード</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          サービス全体の主要 KPI と未対応キューを把握します。
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          KPI 取得に失敗しました。admin 権限と接続状態を確認してください。
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="アクティブユーザー"
            value={data.active_users_total}
            hint={`オンボ完了 ${data.onboarding_completed} / 進行中 ${data.onboarding_in_progress}`}
            icon={Users}
            href="/admin/users"
          />
          <KpiCard
            label="DAU (24h)"
            value={data.dau_24h}
            hint={`WAU ${data.wau_7d} / MAU ${data.mau_30d}`}
            icon={TrendingUp}
          />
          <KpiCard
            label="承諾接続"
            value={data.connections_accepted_total}
            hint={`保留中 ${data.connections_pending}`}
            icon={UserCheck}
          />
          <KpiCard
            label="マッチ件数"
            value={data.matches_total}
            hint="total_score > 0 のスコア行"
            icon={Heart}
          />
          <KpiCard
            label="オンボ完了率"
            value={`${
              data.active_users_total === 0
                ? 0
                : Math.round(
                    (data.onboarding_completed / data.active_users_total) * 100,
                  )
            }%`}
            hint={`${data.onboarding_completed} / ${data.active_users_total}`}
            icon={UserCheck}
            tone={
              data.active_users_total > 0 &&
              data.onboarding_completed / data.active_users_total >= 0.7
                ? "success"
                : "default"
            }
          />
          <KpiCard
            label="取込申請 (未処理 / 処理中)"
            value={`${data.pending_import_requests} / ${data.processing_import_requests}`}
            hint="運営対応待ち / 紐付け作業中"
            icon={Inbox}
            href="/admin/import-requests"
            tone={data.pending_import_requests > 0 ? "warn" : "default"}
          />
          <KpiCard
            label="Transcript エラー"
            value={data.transcript_errors}
            hint="再 fetch が必要"
            icon={AlertTriangle}
            tone={data.transcript_errors > 0 ? "warn" : "default"}
          />
          <KpiCard
            label="不完全プロフィール"
            value={data.incomplete_profiles}
            hint="industry/bio が NULL"
            icon={FileWarning}
            href="/admin/users?incomplete=1"
          />
          <KpiCard
            label="紐付け実績 (7日)"
            value={data.participants_linked_7d}
            hint="manual link で取り込んだ参加者数"
            icon={TrendingUp}
            tone={data.participants_linked_7d > 0 ? "success" : "default"}
          />
        </div>
      )}
    </div>
  );
}
