"use client";

/**
 * /admin/audit-logs
 *
 * 監査ログ検索 (admin only).
 * cursor pagination で 50万行スケール対応.
 * + SHA-256 hash chain 整合性検証 (00048 migration)
 */

import { useState, useDeferredValue } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Search, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

interface ChainResp {
  ok: boolean;
  total_rows: number;
  first_broken_seq: number | null;
  first_broken_id: string | null;
  message: string;
}

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
  const [actor, setActor] = useState("");
  const deferredAction = useDeferredValue(actionQ);
  const deferredEntity = useDeferredValue(entityType);
  const deferredActor = useDeferredValue(actor);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<PageResp>({
      queryKey: ["admin-audit-logs", deferredAction, deferredEntity, deferredActor],
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams();
        if (deferredAction.trim()) params.set("action", deferredAction.trim());
        if (deferredEntity.trim()) params.set("entity_type", deferredEntity.trim());
        if (deferredActor.trim()) params.set("actor", deferredActor.trim());
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
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">監査ログ</h1>
          <ChainVerifyButton />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          システム上の操作履歴。actor・action・対象で絞込できます。
          各行は SHA-256 hash chain で改竄検知可能。
        </p>
      </header>

      {/* フィルタ */}
      <div className="sticky top-14 z-30 -mx-4 mb-4 grid gap-2 bg-background/95 px-4 py-2 backdrop-blur landscape:top-12 sm:grid-cols-3 supports-[backdrop-filter]:bg-background/80">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={actionQ}
            onChange={(e) => setActionQ(e.target.value)}
            placeholder="action 部分一致"
            aria-label="action で検索"
            className="pl-9"
          />
        </div>
        <Input
          type="search"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          placeholder="entity_type 完全一致"
          aria-label="entity_type で検索"
        />
        <Input
          type="search"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="actor UUID 完全一致"
          aria-label="actor UUID で検索"
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

      <ul className="space-y-1.5 list-none p-0 text-xs">
        {allItems.map((log) => (
          <li
            key={log.id}
            className="rounded border bg-card px-3 py-2 shadow-sm"
          >
            <div className="flex flex-col gap-x-2 gap-y-0.5 font-mono sm:flex-row sm:flex-wrap sm:items-center">
              <span className="text-muted-foreground">
                {new Date(log.created_at).toLocaleString("ja-JP")}
              </span>
              <code className="inline-block rounded bg-muted px-1.5 py-0.5">
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
            </div>
            {log.payload && Object.keys(log.payload).length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                  payload を表示
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[10px] leading-tight">
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
              </details>
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

function ChainVerifyButton() {
  const [result, setResult] = useState<ChainResp | null>(null);
  const verify = useMutation({
    mutationFn: () => api.get<ChainResp>("/admin/audit-chain/verify"),
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) {
        toast.success(`整合性 OK: ${data.total_rows} 行検証`);
      } else {
        toast.error(`不整合検出: seq=${data.first_broken_seq}`);
      }
    },
    onError: () => toast.error("検証に失敗しました"),
  });

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => verify.mutate()}
        disabled={verify.isPending}
      >
        {verify.isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        )}
        Chain 整合性検証
      </Button>
      {result && (
        <Badge
          variant={result.ok ? "outline" : "destructive"}
          className="text-[10px]"
        >
          {result.ok ? (
            <>
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              {result.total_rows} 行 OK
            </>
          ) : (
            <>
              <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
              seq={result.first_broken_seq} 改竄?
            </>
          )}
        </Badge>
      )}
    </div>
  );
}
