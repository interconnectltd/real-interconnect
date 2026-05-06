"use client";

/**
 * /admin/import-requests
 *
 * 会議データ取込申請の管理画面 (admin only)。
 * - 申請一覧 (status / 申請者 / メッセージ)
 * - 状態変更ボタン (処理中 / 完了 / 却下)
 */

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, Check, X, FolderInput } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LinkMeetingsDialog } from "./_link-meetings-dialog";

type Status = "pending" | "processing" | "done" | "rejected" | "cancelled";

interface ImportRequest {
  id: string;
  user_id: string;
  status: Status;
  message: string | null;
  source: "tldv" | "manual_csv" | "other";
  admin_note: string | null;
  processed_at: string | null;
  created_at: string;
  user_profiles: {
    id: string;
    name: string;
    email: string;
    company: string | null;
  } | null;
}

const STATUS_LABEL: Record<Status, string> = {
  pending: "申請中",
  processing: "処理中",
  done: "完了",
  rejected: "却下",
  cancelled: "キャンセル",
};

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  processing: "secondary",
  done: "outline",
  rejected: "destructive",
  cancelled: "outline",
};

export default function AdminImportRequestsPage() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<Status | "all">("pending");
  const [linkingRequest, setLinkingRequest] = useState<ImportRequest | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-import-requests", filterStatus],
    queryFn: () =>
      api.get<ImportRequest[]>(
        `/admin/import-requests${filterStatus === "all" ? "" : `?status=${filterStatus}`}`,
      ),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: Status; note?: string }) => {
      return api.patch(`/admin/import-requests?id=${id}`, {
        status,
        admin_note: note ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-import-requests"] });
      toast.success("更新しました");
    },
    onError: () => toast.error("更新に失敗しました"),
  });

  const counts = (data ?? []).reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold tracking-widest text-emerald-600">
          ADMIN
        </p>
        <h1 className="mt-1 text-2xl font-bold">会議データ取込申請</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          ユーザーから運営への会議データ取込申請を管理します。
        </p>
      </header>

      {/* フィルタ — SP では tablist が 2 段折返しすると ARIA 操作と矛盾するため横スクロール */}
      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap" role="tablist">
          {(["pending", "processing", "done", "rejected", "all"] as const).map((s) => {
            const count = s === "all" ? data?.length ?? 0 : counts[s] ?? 0;
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
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          読み込みに失敗しました。admin 権限を確認してください。
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <div className="rounded-md border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          該当する申請はありません。
        </div>
      )}

      <ul className="space-y-3 list-none p-0">
        {data?.map((req) => (
          <li
            key={req.id}
            className="rounded-lg border bg-card p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANT[req.status]}>
                    {STATUS_LABEL[req.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(req.created_at).toLocaleString("ja-JP")}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {req.source}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-semibold">
                  {req.user_profiles?.name ?? "(unknown)"}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {req.user_profiles?.email}
                  </span>
                </p>
                {req.user_profiles?.company && (
                  <p className="text-xs text-muted-foreground">
                    {req.user_profiles.company}
                  </p>
                )}
                {req.message && (
                  <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-sm">
                    {req.message}
                  </p>
                )}
                {req.admin_note && (
                  <p className="mt-2 rounded border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    Note: {req.admin_note}
                  </p>
                )}
              </div>

              {/* 状態変更ボタン: SP では行下段に flex-row 配置、md 以上で右側縦並び。
                  「会議を選んで紐付ける」が主アクション (これが処理本体)。 */}
              {(req.status === "pending" || req.status === "processing") && (
                <div className="flex shrink-0 flex-row flex-wrap gap-2 md:flex-col">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setLinkingRequest(req)}
                    aria-label="会議を選んで紐付ける"
                  >
                    <FolderInput className="mr-1 h-4 w-4" aria-hidden="true" />
                    会議を選択
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const note = prompt("完了メモ (任意)") ?? undefined;
                      updateMutation.mutate({ id: req.id, status: "done", note });
                    }}
                    disabled={updateMutation.isPending}
                    aria-label="完了"
                  >
                    <Check className="mr-1 h-4 w-4" aria-hidden="true" />
                    完了
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      const note = prompt("却下理由") ?? undefined;
                      if (!note) return;
                      updateMutation.mutate({ id: req.id, status: "rejected", note });
                    }}
                    disabled={updateMutation.isPending}
                    aria-label="却下"
                  >
                    <X className="mr-1 h-4 w-4" aria-hidden="true" />
                    却下
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {linkingRequest && (
        <LinkMeetingsDialog
          request={linkingRequest}
          onClose={() => setLinkingRequest(null)}
          onLinked={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-import-requests"] });
          }}
        />
      )}
    </div>
  );
}
