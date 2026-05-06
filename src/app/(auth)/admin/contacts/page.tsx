"use client";

/**
 * /admin/contacts
 *
 * /contact フォームから受信した問い合わせの inbox。
 * SLA 超過先頭表示 + status / kind フィルタ + 状態遷移ボタン。
 */

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, Check, X, Inbox, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Status =
  | "new"
  | "assigned"
  | "in_progress"
  | "awaiting_user"
  | "resolved"
  | "rejected";

type Kind =
  | "general"
  | "support"
  | "data_disclosure"
  | "data_deletion"
  | "tokushoho"
  | "urgent_removal"
  | "press"
  | "partnership";

interface ContactMessage {
  id: string;
  sender_name: string;
  sender_email: string;
  sender_user_id: string | null;
  kind: Kind;
  subject: string;
  body: string;
  status: Status;
  assignee_id: string | null;
  sla_due_at: string;
  resolved_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: "新規",
  assigned: "担当割当",
  in_progress: "対応中",
  awaiting_user: "ユーザー返信待ち",
  resolved: "解決",
  rejected: "却下",
};

const KIND_LABEL: Record<Kind, string> = {
  general: "一般",
  support: "サポート",
  data_disclosure: "個情法 開示",
  data_deletion: "削除請求",
  tokushoho: "特商法 開示",
  urgent_removal: "緊急削除",
  press: "取材",
  partnership: "提携",
};

export default function AdminContactsPage() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<Status | "all">("new");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-contacts", filterStatus],
    queryFn: () =>
      api.get<ContactMessage[]>(
        `/admin/contacts${filterStatus === "all" ? "" : `?status=${filterStatus}`}`,
      ),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) =>
      api.patch(`/admin/contacts?id=${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      toast.success("更新しました");
    },
    onError: () => toast.error("更新に失敗しました"),
  });

  const counts = (data ?? []).reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
          ADMIN
        </p>
        <h1 className="mt-1 text-2xl font-bold">お問い合わせ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          /contact フォームから届いたお問い合わせを管理します。SLA 超過案件が先頭に表示されます。
        </p>
      </header>

      {/* フィルタ */}
      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap" role="tablist">
          {(
            [
              "new",
              "assigned",
              "in_progress",
              "awaiting_user",
              "resolved",
              "all",
            ] as const
          ).map((s) => {
            const count =
              s === "all" ? data?.length ?? 0 : counts[s] ?? 0;
            return (
              <Button
                key={s}
                size="sm"
                variant={filterStatus === s ? "default" : "outline"}
                onClick={() => setFilterStatus(s)}
                role="tab"
                aria-selected={filterStatus === s}
                className="shrink-0"
              >
                {s === "all" ? "すべて" : STATUS_LABEL[s as Status]}
                <span className="ml-1.5 text-xs opacity-70">({count})</span>
              </Button>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status">
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-label="読み込み中"
          />
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          読み込みに失敗しました。admin 権限を確認してください。
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <div className="rounded-md border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          該当するお問い合わせはありません。
        </div>
      )}

      <ul className="space-y-3 list-none p-0">
        {data?.map((c) => {
          const slaOver =
            c.status !== "resolved" &&
            c.status !== "rejected" &&
            new Date(c.sla_due_at) < new Date();
          return (
            <li key={c.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{STATUS_LABEL[c.status]}</Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {KIND_LABEL[c.kind]}
                    </Badge>
                    {slaOver && (
                      <Badge variant="destructive" className="text-[10px]">
                        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
                        SLA 超過
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold">{c.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.sender_name} ({c.sender_email})
                  </p>
                  <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-sm">
                    {c.body}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    SLA 期限: {new Date(c.sla_due_at).toLocaleString("ja-JP")}
                  </p>
                </div>

                {(c.status !== "resolved" && c.status !== "rejected") && (
                  <div className="flex shrink-0 flex-row flex-wrap gap-2 md:flex-col">
                    {c.status === "new" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          updateMutation.mutate({ id: c.id, status: "in_progress" })
                        }
                        disabled={updateMutation.isPending}
                      >
                        対応開始
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({ id: c.id, status: "resolved" })
                      }
                      disabled={updateMutation.isPending}
                    >
                      <Check className="mr-1 h-4 w-4" aria-hidden="true" />
                      解決
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        updateMutation.mutate({ id: c.id, status: "rejected" })
                      }
                      disabled={updateMutation.isPending}
                    >
                      <X className="mr-1 h-4 w-4" aria-hidden="true" />
                      却下
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
