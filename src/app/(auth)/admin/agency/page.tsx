"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Clock, ListChecks, Percent } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useAdminAgencyApplications,
  useReviewAgencyApplication,
  useAdminAgencies,
  useUpdateCommissionRate,
  useSuspendAgency,
  type AdminAgencyApplication,
  type AdminAgency,
} from "@/hooks/queries/use-admin-agency";
import { cn } from "@/lib/utils";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const STATUS_LABEL: Record<StatusFilter, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  all: "すべて",
};

const STATUS_BADGE: Record<string, string> = {
  pending:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  approved:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  rejected:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200",
};

const RANK_BADGE: Record<string, string> = {
  diamond: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200",
  platinum: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200",
  gold: "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  silver: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200",
  bronze: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminAgencyApplicationsPage() {
  const [tab, setTab] = useState<StatusFilter>("pending");
  const [reviewTarget, setReviewTarget] = useState<{
    app: AdminAgencyApplication;
    action: "approve" | "reject";
  } | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [rateTarget, setRateTarget] = useState<AdminAgency | null>(null);
  const [newRatePercent, setNewRatePercent] = useState("");

  const { data, isLoading, refetch } = useAdminAgencyApplications(tab);
  const review = useReviewAgencyApplication();
  const agenciesQuery = useAdminAgencies();
  const updateRate = useUpdateCommissionRate();
  const suspend = useSuspendAgency();

  const tabs: StatusFilter[] = ["pending", "approved", "rejected", "all"];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:py-8">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
          ADMIN
        </p>
        <h1 className="flex items-center gap-2 text-xl font-bold md:text-2xl">
          <ListChecks className="h-5 w-5" />
          代理店管理
        </h1>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="申請ステータス"
      >
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-9 rounded-t-md px-3 py-2 text-sm transition-colors",
              tab === t
                ? "border-b-2 border-primary font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {STATUS_LABEL[t]}
          </button>
        ))}
      </nav>

      {tab === "approved" ? (
        agenciesQuery.isLoading ? (
          <div className="flex justify-center py-12" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
          </div>
        ) : (agenciesQuery.data?.agencies ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              承認済みの代理店はありません
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {(agenciesQuery.data?.agencies ?? []).map((ag) => (
              <li key={ag.user_id}>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{ag.profile?.name ?? "(不明)"}</CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ag.profile?.email ?? "—"} · {ag.profile?.company ?? "—"}
                        </p>
                      </div>
                      <Badge variant="outline" className={RANK_BADGE[ag.current_rank] ?? ""}>
                        {ag.current_rank}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">紹介料率</p>
                        <p className="font-bold tabular-nums">{(ag.commission_rate * 100).toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">紹介数</p>
                        <p className="tabular-nums">{ag.total_referrals.toLocaleString("ja-JP")} 人</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">累計報酬</p>
                        <p className="tabular-nums">¥{ag.total_earnings_jpy.toLocaleString("ja-JP")}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">承認日</p>
                        <p>{ag.approved_at ? formatDate(ag.approved_at) : "—"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRateTarget(ag);
                          setNewRatePercent(String((ag.commission_rate * 100).toFixed(0)));
                        }}
                      >
                        <Percent className="mr-1 h-3.5 w-3.5" />
                        料率変更
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={async () => {
                          if (!window.confirm(`${ag.profile?.name ?? "この代理店"} を停止しますか？`)) return;
                          await suspend.mutateAsync({ userId: ag.user_id, action: "suspend" });
                        }}
                      >
                        停止
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : isLoading ? (
        <div className="flex justify-center py-12" aria-live="polite">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      ) : (data?.applications ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {STATUS_LABEL[tab]} の申請はありません
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {(data?.applications ?? []).map((app) => (
            <li key={app.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        {app.applicant?.name ?? "(不明)"}
                      </CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {app.applicant?.email ?? "—"} ·{" "}
                        {app.applicant?.company ?? "—"}
                      </p>
                    </div>
                    <Badge variant="outline" className={STATUS_BADGE[app.status]}>
                      {app.status === "pending" && (
                        <Clock className="mr-0.5 h-3 w-3" aria-hidden="true" />
                      )}
                      {app.status === "approved" && (
                        <CheckCircle2 className="mr-0.5 h-3 w-3" aria-hidden="true" />
                      )}
                      {app.status === "rejected" && (
                        <XCircle className="mr-0.5 h-3 w-3" aria-hidden="true" />
                      )}
                      {STATUS_LABEL[app.status as StatusFilter] ?? app.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {app.applicant_note && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        申請理由
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">
                        {app.applicant_note}
                      </p>
                    </div>
                  )}
                  {app.admin_note && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        管理者メモ
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">
                        {app.admin_note}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      申請: {formatDate(app.created_at)}
                      {app.reviewed_at && ` · レビュー: ${formatDate(app.reviewed_at)}`}
                    </span>
                    <span className="font-medium text-foreground">
                      紹介料率: {(app.commission_rate * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {app.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setReviewTarget({ app, action: "approve" });
                            setAdminNote("");
                          }}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          承認
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setReviewTarget({ app, action: "reject" });
                            setAdminNote("");
                          }}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" />
                          却下
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRateTarget({
                          user_id: app.applicant_id,
                          commission_rate: app.commission_rate,
                          status: app.status,
                          current_rank: "bronze",
                          total_referrals: 0,
                          total_clicks: 0,
                          total_earnings_jpy: 0,
                          current_balance_jpy: 0,
                          approved_at: null,
                          created_at: app.created_at,
                          profile: app.applicant,
                        });
                        setNewRatePercent(String((app.commission_rate * 100).toFixed(0)));
                      }}
                    >
                      <Percent className="mr-1 h-3.5 w-3.5" />
                      料率変更
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={reviewTarget !== null}
        onOpenChange={(o) => !o && setReviewTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewTarget?.app.applicant?.name ?? "申請者"} さんを
              {reviewTarget?.action === "approve" ? "承認" : "却下"}しますか?
            </DialogTitle>
            <DialogDescription>
              {reviewTarget?.action === "approve"
                ? "承認すると、代理店ダッシュボードと紹介リンク発行が有効化されます。"
                : "却下すると、申請は再申請可能になります。"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label
              htmlFor="admin-note"
              className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              管理者メモ (任意、最大 1000 字)
            </label>
            <textarea
              id="admin-note"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              maxLength={1000}
              rows={4}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              placeholder={
                reviewTarget?.action === "approve"
                  ? "例: ヒアリング済、問題なし"
                  : "例: 申請理由が不明瞭。再申請時に補足を依頼"
              }
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {adminNote.length} / 1000
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>
              キャンセル
            </Button>
            <Button
              disabled={review.isPending}
              aria-busy={review.isPending}
              onClick={async () => {
                if (!reviewTarget) return;
                await review.mutateAsync({
                  id: reviewTarget.app.id,
                  action: reviewTarget.action,
                  admin_note: adminNote.trim() || undefined,
                });
                setReviewTarget(null);
                refetch();
              }}
            >
              {review.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  処理中
                </>
              ) : reviewTarget?.action === "approve" ? (
                "承認する"
              ) : (
                "却下する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rateTarget !== null}
        onOpenChange={(o) => !o && setRateTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>紹介料率を変更</DialogTitle>
            <DialogDescription>
              {rateTarget?.profile?.name ?? "代理店"} の紹介料率を変更します。変更は次回以降の支払いから適用されます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="rate-input">紹介料率 (%)</Label>
              <Input
                id="rate-input"
                type="number"
                min={1}
                max={100}
                step={1}
                value={newRatePercent}
                onChange={(e) => setNewRatePercent(e.target.value)}
                className="mt-1"
              />
            </div>
            {rateTarget && newRatePercent && (
              <p className="text-sm text-muted-foreground">
                現在: {(rateTarget.commission_rate * 100).toFixed(0)}% → 新: {newRatePercent}%
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateTarget(null)}>
              キャンセル
            </Button>
            <Button
              disabled={
                updateRate.isPending ||
                !newRatePercent ||
                Number(newRatePercent) < 1 ||
                Number(newRatePercent) > 100
              }
              aria-busy={updateRate.isPending}
              onClick={async () => {
                if (!rateTarget || !newRatePercent) return;
                await updateRate.mutateAsync({
                  userId: rateTarget.user_id,
                  rate: Number(newRatePercent) / 100,
                });
                setRateTarget(null);
              }}
            >
              {updateRate.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  変更中
                </>
              ) : (
                "変更する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
