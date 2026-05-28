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
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
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

      {/* 検索バー: SP で sticky (Header h-14 の下に固定 / landscape は h-12) */}
      <div className="sticky top-14 z-30 -mx-4 mb-4 bg-background/95 px-4 py-2 backdrop-blur landscape:top-12 supports-[backdrop-filter]:bg-background/80">
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

      {/* SP〜タブレット: card stack / lg+: テーブル (狭幅ではテーブルが詰まるためカードに切替) */}
      <ul className="space-y-2 list-none p-0 lg:hidden">
        {data?.users.map((u) => (
          <li key={u.id}>
            <Link
              href={`/admin/users/${u.id}`}
              className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm transition-colors hover:bg-muted/50"
            >
              <UserAvatar name={u.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{u.name}</p>
                  <UserBadges user={u} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {u.email ?? "(no email)"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[u.company, u.position].filter(Boolean).join(" / ") || "(未設定)"}
                  {u.industry && <span className="ml-2 text-muted-foreground/70">· {u.industry}</span>}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border bg-card lg:block">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[24%]" />
            <col className="w-[14%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium">ユーザー</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium">会社 / 役職</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium">業界</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium">状態</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium">登録日</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className="border-b last:border-b-0 transition-colors hover:bg-muted/40">
                <td className="px-4 py-3 align-middle">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="group flex min-w-0 items-center gap-3"
                  >
                    <UserAvatar name={u.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground group-hover:underline">
                        {u.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.email ?? "—"}
                      </p>
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="min-w-0">
                    <p className="truncate text-foreground/90">
                      {u.company ?? "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.position ?? "—"}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-3 align-middle">
                  {u.industry ? (
                    <span className="inline-flex max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">
                      {u.industry}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  <UserBadges user={u} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-middle text-xs tabular-nums text-muted-foreground">
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
          className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
        >
          <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
          admin
        </Badge>
      )}
      {!user.is_active && <Badge variant="destructive" className="whitespace-nowrap">停止中</Badge>}
      {(user.onboarding_step ?? 0) < 3 && (
        <Badge variant="secondary" className="whitespace-nowrap">オンボ未完了</Badge>
      )}
    </span>
  );
}

function UserAvatar({ name }: { name: string }) {
  const initial = (name?.trim().charAt(0) || "?").toUpperCase();
  // 名前から決定的に色相を導出 (HSL) → ユーザーごとに固定の見た目
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0x7fffffff;
  const hue = hash % 360;
  return (
    <div
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-1 ring-black/5"
      style={{ backgroundColor: `hsl(${hue}, 45%, 55%)` }}
    >
      {initial}
    </div>
  );
}
