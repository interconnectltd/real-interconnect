"use client";

/**
 * ImportRequestCTA
 *
 * 会議データ未取込時に表示する CTA カード。
 * - 既存 pending 申請があれば「申請中」表示
 * - 無ければ「運営に取込申請する」ボタン
 *
 * matching / dashboard / chat ページの空状態に挿入する想定。
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Send, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { Button } from "@/components/ui/button";

interface ImportRequest {
  id: string;
  status: "pending" | "processing" | "done" | "rejected" | "cancelled";
  message: string | null;
  source: string;
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
}

interface ImportRequestResponse {
  requests: ImportRequest[];
  stats: { linked_meetings: number };
}

const STATUS_LABEL: Record<string, string> = {
  pending: "申請中（運営の対応待ち）",
  processing: "運営が処理中",
  done: "取込完了",
  rejected: "却下",
  cancelled: "キャンセル",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export function ImportRequestCTA() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["import-requests"],
    queryFn: () => api.get<ImportRequestResponse>("/import-requests"),
  });
  const requests = data?.requests ?? [];
  const linkedMeetings = data?.stats.linked_meetings ?? 0;

  const submitMutation = useMutation({
    mutationFn: async (msg: string) =>
      api.post("/import-requests", { message: msg || null, source: "tldv" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-requests"] });
      setMessage("");
      setShowForm(false);
      toast.success("申請を送信しました");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "ALREADY_PENDING") {
        toast.info("既に申請中です");
      } else {
        toast.error("送信に失敗しました");
      }
    },
  });

  const latest = requests[0];
  const activeStatus =
    latest && (latest.status === "pending" || latest.status === "processing")
      ? latest.status
      : null;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center" role="status">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
      </div>
    );
  }

  // 申請中 or 処理中の表示
  if (activeStatus && latest) {
    const msg = latest.message;
    return (
      <div
        className={`rounded-lg border px-5 py-4 ${STATUS_COLOR[activeStatus]}`}
        role="status"
      >
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              {STATUS_LABEL[activeStatus]}
            </p>
            <p className="mt-1 text-xs">
              {new Date(latest.created_at).toLocaleDateString("ja-JP")} 申請
              {msg && (
                <span className="ml-2 opacity-70">「{msg.slice(0, 40)}{msg.length > 40 ? "…" : ""}」</span>
              )}
            </p>
            <p className="mt-2 text-xs opacity-80">
              運営が会議データを取り込み中です。完了次第マッチング精度が向上します。
            </p>
            {linkedMeetings > 0 && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                取込済 {linkedMeetings} 件
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 完了済 / 拒否 / キャンセル → 申請可能
  // 直近 rejected の場合、admin_note を表示
  const lastRejected = requests.find((r) => r.status === "rejected");

  return (
    <div className="rounded-lg border bg-gradient-to-br from-emerald-50 to-blue-50 px-5 py-5 dark:from-emerald-950/20 dark:to-blue-950/20">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">
            会議データを取り込んで精度を上げる
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            tl:dv 等で記録した会議データを INTER CONNECT に取り込むと、
            会話内容に基づくマッチング精度が大幅に向上します。
          </p>

          {lastRejected?.admin_note && (
            <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/20">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                前回の申請は却下されました: {lastRejected.admin_note}
              </p>
            </div>
          )}

          {requests.some((r) => r.status === "done") && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              過去に取込完了した履歴があります {linkedMeetings > 0 && `(取込済 ${linkedMeetings} 件)`}
            </div>
          )}

          {showForm ? (
            <div className="mt-4 space-y-2">
              <label htmlFor="import-msg" className="block text-xs font-medium">
                運営への伝達事項（任意）
              </label>
              <textarea
                id="import-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="例: tl:dv の○月○日以降の会議を取り込んでほしい"
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 sm:text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => submitMutation.mutate(message.trim())}
                  disabled={submitMutation.isPending}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  送信
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setMessage("");
                  }}
                  disabled={submitMutation.isPending}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => setShowForm(true)}
              className="mt-3"
            >
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              運営に取込申請する
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
