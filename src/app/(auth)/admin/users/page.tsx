"use client";

/**
 * /admin/users
 *
 * ユーザー一覧 (admin only). 検索 + フィルタ + ページネーション.
 * SP では card stack に切替.
 */

import { useState, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Search, ChevronLeft, ChevronRight, ShieldCheck, FileWarning } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  position: string | null;
  industry: string | null;
  is_admin: boolean;
  is_active: boolean;
  onboarding_step: number | null;
  created_at: string;
}

interface ListResponse {
  users: UserRow[];
  meta: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

export default function AdminUsersPage() {
  const searchParams = useSearchParams();
  const incomplete = searchParams.get("incomplete") === "1";
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const deferredQ = useDeferredValue(q);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-users", deferredQ, page, incomplete],
    queryFn: () => {
      const params = new URLSearchParams();
      if (deferredQ.trim()) params.set("q", deferredQ.trim());
      if (incomplete) params.set("incomplete", "1");
      params.set("page", String(page));
      params.set("pageSize", "50");
      return api.get<ListResponse>(`/admin/users?${params.toString()}`);
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
          ADMIN
        </p>
        <h1 className="mt-1 text-2xl font-bold">ユーザー</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          登録済みユーザーの検索・閲覧。詳細表示には閲覧理由の入力が必要です (法務 R5)。
        </p>
      </header>

      {/* アクティブフィルタ表示 */}
      {incomplete && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          >
            <FileWarning className="mr-1 h-3 w-3" aria-hidden="true" />
            不完全プロフィール (industry/bio NULL)
          </Badge>
          <Link href="/admin/users" className="text-xs text-muted-foreground underline">
            フィルタ解除
          </Link>
        </div>
      )}

      {/* 検索バー: SP で sticky */}
      <div className="sticky top-0 z-30 -mx-4 mb-4 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="名前・会社・メールで検索"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pl-9"
            aria-label="ユーザー検索"
          />
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

      {!isLoading && !isError && (data?.users.length ?? 0) === 0 && (
        <div className="rounded-md border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          該当するユーザーはいません。
        </div>
      )}

      {/* SP: card stack / md+: テーブル */}
      <ul className="space-y-2 list-none p-0 md:hidden">
        {data?.users.map((u) => (
          <li key={u.id}>
            <Link
              href={`/admin/users/${u.id}`}
              className="block rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{u.name}</p>
                <UserBadges user={u} />
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {u.email ?? "(no email)"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[u.company, u.position].filter(Boolean).join(" / ") || "(未設定)"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">名前</th>
              <th className="px-4 py-2 text-left">メール</th>
              <th className="px-4 py-2 text-left">会社 / 役職</th>
              <th className="px-4 py-2 text-left">業界</th>
              <th className="px-4 py-2 text-left">状態</th>
              <th className="px-4 py-2 text-left">登録日</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {u.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {u.email ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {[u.company, u.position].filter(Boolean).join(" / ") || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.industry ?? "—"}</td>
                <td className="px-4 py-3">
                  <UserBadges user={u} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString("ja-JP")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ページネーション */}
      {data && data.meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2 text-sm">
          <p className="text-xs text-muted-foreground">
            全 {data.meta.totalCount} 件中 {(page - 1) * data.meta.pageSize + 1}-
            {Math.min(page * data.meta.pageSize, data.meta.totalCount)} 件
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="前のページ"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 text-xs tabular-nums">
              {page} / {data.meta.totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(data.meta.totalPages, p + 1))}
              disabled={page >= data.meta.totalPages}
              aria-label="次のページ"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserBadges({ user }: { user: UserRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {user.is_admin && (
        <Badge
          variant="outline"
          className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
        >
          <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
          admin
        </Badge>
      )}
      {!user.is_active && <Badge variant="destructive">停止中</Badge>}
      {(user.onboarding_step ?? 0) < 3 && (
        <Badge variant="secondary">オンボ未完了</Badge>
      )}
    </span>
  );
}
