"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Clock, ListChecks } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
import {
  useAdminAgencyApplications,
  useReviewAgencyApplication,
  type AdminAgencyApplication,
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

  const { data, isLoading, refetch } = useAdminAgencyApplications(tab);
  const review = useReviewAgencyApplication();

  const tabs: StatusFilter[] = ["pending", "approved", "rejected", "all"];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:py-8">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
          ADMIN
        </p>
        <h1 className="flex items-center gap-2 text-xl font-bold md:text-2xl">
          <ListChecks className="h-5 w-5" />
          代理店申請レビュー
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

      {isLoading ? (
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
                  <p className="text-xs text-muted-foreground">
                    申請: {formatDate(app.created_at)}
                    {app.reviewed_at && ` · レビュー: ${formatDate(app.reviewed_at)}`}
                  </p>
                  {app.status === "pending" && (
                    <div className="flex flex-wrap gap-2 pt-2">
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
                    </div>
                  )}
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
    </div>
  );
}
