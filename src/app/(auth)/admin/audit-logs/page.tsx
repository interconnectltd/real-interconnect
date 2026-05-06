"use client";

/**
 * /admin/audit-logs
 *
 * 監査ログ検索 (admin only).
 * cursor pagination で 50万行スケール対応.
 */

import { useState, useDeferredValue } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

interface PageResp {
  items: AuditLog[];
  nextCursor: string | null;
}

export default function AdminAuditLogsPage() {
  const [actionQ, setActionQ] = useState("");
  const [entityType, setEntityType] = useState("");
  const deferredAction = useDeferredValue(actionQ);
  const deferredEntity = useDeferredValue(entityType);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<PageResp>({
      queryKey: ["admin-audit-logs", deferredAction, deferredEntity],
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams();
        if (deferredAction.trim()) params.set("action", deferredAction.trim());
        if (deferredEntity.trim()) params.set("entity_type", deferredEntity.trim());
        if (pageParam) params.set("cursor", pageParam as string);
        params.set("limit", "50");
        return api.get<PageResp>(`/admin/audit-logs?${params.toString()}`);
      },
      staleTime: 30_000,
    });

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
          ADMIN
        </p>
        <h1 className="mt-1 text-2xl font-bold">監査ログ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          システム上の操作履歴。actor・action・対象で絞込できます。
        </p>
      </header>

      {/* フィルタ */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 grid gap-2 bg-background/95 px-4 py-2 backdrop-blur sm:grid-cols-2 supports-[backdrop-filter]:bg-background/80">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={actionQ}
            onChange={(e) => setActionQ(e.target.value)}
            placeholder="action で部分一致 (例: chat / view_user)"
            aria-label="action で検索"
            className="pl-9"
          />
        </div>
        <Input
          type="search"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          placeholder="entity_type 完全一致 (例: user / chat_message)"
          aria-label="entity_type で検索"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          読み込みに失敗しました。
        </div>
      )}

      {!isLoading && !isError && allItems.length === 0 && (
        <div className="rounded-md border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          監査ログはありません。
        </div>
      )}

      <ul className="space-y-1.5 list-none p-0 font-mono text-xs">
        {allItems.map((log) => (
          <li
            key={log.id}
            className="flex flex-wrap items-center gap-x-2 rounded border bg-card px-3 py-1.5 shadow-sm"
          >
            <span className="text-muted-foreground">
              {new Date(log.created_at).toLocaleString("ja-JP")}
            </span>
            <code className="rounded bg-muted px-1.5 py-0.5">
              {log.action}
            </code>
            {log.target_type && (
              <span className="text-muted-foreground">
                → {log.target_type}
                {log.target_id ? `:${log.target_id.slice(0, 8)}…` : ""}
              </span>
            )}
            {log.actor_id && (
              <span className="text-muted-foreground">
                actor:{log.actor_id.slice(0, 8)}…
              </span>
            )}
            {log.ip && (
              <span className="text-muted-foreground">{log.ip}</span>
            )}
          </li>
        ))}
      </ul>

      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "読み込み中..." : "さらに読み込む"}
          </Button>
        </div>
      )}
    </div>
  );
}
