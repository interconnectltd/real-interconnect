"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Search,
  Bookmark,
  UserPlus,
  CheckCircle2,
  Clock,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useMembers } from "@/hooks/queries/use-members";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { useToggleBookmark } from "@/hooks/mutations/use-toggle-bookmark";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useConnections } from "@/hooks/queries/use-connections";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  INDUSTRIES,
  POSITIONS,
  MEMBER_SORT_OPTIONS,
  type MemberSortBy,
} from "@/lib/constants";
import type { Profile, Connection } from "@/types";

export default function MembersPage() {
  const {
    memberSearch, setMemberSearch,
    memberIndustryFilter, setMemberIndustryFilter,
    memberSortBy, setMemberSortBy,
    memberPositionFilter, setMemberPositionFilter,
  } = useFilterStore();
  const [page, setPage] = useState(1);
  const selectedIndustry = memberIndustryFilter[0] ?? undefined;

  // 検索 input は即時反映、API クエリは 250ms デバウンス
  const debouncedSearch = useDebouncedValue(memberSearch, 250);

  // フィルタ/ソート/検索が変わったら必ず page=1 にリセット
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, memberIndustryFilter, memberPositionFilter, memberSortBy]);

  const { data, isLoading } = useMembers(debouncedSearch, {
    industry: selectedIndustry,
    position: memberPositionFilter || undefined,
    sort: memberSortBy,
    page,
  });
  const { data: bookmarksData } = useBookmarks();
  const { data: connections } = useConnections();
  const toggleBookmark = useToggleBookmark();
  const requestConnection = useRequestConnection();
  const { openProfileModal } = useUIStore();

  const bookmarkedIds = useMemo(
    () =>
      new Set(
        (bookmarksData as { bookmarked_user_id: string }[] | undefined)?.map(
          (b) => b.bookmarked_user_id,
        ) ?? [],
      ),
    [bookmarksData],
  );

  const { connectedIds, pendingIds } = useMemo(() => {
    const conns = connections as Connection[] | undefined;
    const connected = new Set(
      conns
        ?.filter((c) => c.status === "accepted" || c.status === "reaccepted")
        .flatMap((c) => [c.user_id, c.connected_user_id]) ?? [],
    );
    const pending = new Set(
      conns
        ?.filter((c) => c.status === "pending")
        .flatMap((c) => [c.user_id, c.connected_user_id]) ?? [],
    );
    return { connectedIds: connected, pendingIds: pending };
  }, [connections]);

  const members = data?.members;
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount;

  const hasFilter = Boolean(
    selectedIndustry || memberPositionFilter || memberSearch.trim(),
  );

  function clearFilters() {
    setMemberSearch("");
    setMemberIndustryFilter([]);
    setMemberPositionFilter("");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Page header */}
      <div>
        <p className="ds-eyebrow">Directory</p>
        <h1 className="ds-h1 mt-1 tracking-tight text-foreground">メンバー</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ネットワーク内のプロフェッショナル
          {typeof totalCount === "number" && (
            <span className="ml-1.5 tabular-nums text-foreground">
              （{totalCount.toLocaleString()}名）
            </span>
          )}
        </p>
      </div>

      {/* Filters card — Search + Sort + Industry + Position */}
      <Card>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="名前、会社名、自己紹介で検索..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="pl-9"
              aria-label="メンバーを検索"
            />
          </div>

          <SortToggle value={memberSortBy} onChange={setMemberSortBy} />

          <FilterRow
            icon={Filter}
            label="業種"
            items={[
              { value: undefined as string | undefined, label: "すべて" },
              ...INDUSTRIES.map((ind) => ({ value: ind, label: ind })),
            ]}
            selected={selectedIndustry}
            onSelect={(v) => setMemberIndustryFilter(v ? [v] : [])}
          />

          <FilterRow
            icon={Filter}
            label="役職"
            items={[
              { value: "" as string, label: "全役職" },
              ...POSITIONS.map((pos) => ({ value: pos, label: pos })),
            ]}
            selected={memberPositionFilter}
            onSelect={(v) => setMemberPositionFilter(v ?? "")}
          />

          {hasFilter && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground"
              >
                条件をクリア
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Member list */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      ) : members && members.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                bookmarked={bookmarkedIds.has(member.id)}
                connected={connectedIds.has(member.id)}
                pending={pendingIds.has(member.id)}
                connectPending={requestConnection.isPending}
                bookmarkPending={toggleBookmark.isPending}
                onOpen={() => openProfileModal(member.id)}
                onToggleBookmark={() =>
                  toggleBookmark.mutate({
                    userId: member.id,
                    isBookmarked: bookmarkedIds.has(member.id),
                  })
                }
                onConnect={() => requestConnection.mutate(member.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onChange={setPage}
            />
          )}
        </>
      ) : (
        <EmptyState search={memberSearch.trim()} hasFilter={hasFilter} onClear={clearFilters} />
      )}
    </div>
  );
}

/* ───────── Subcomponents ───────── */

function SortToggle({
  value,
  onChange,
}: {
  value: MemberSortBy;
  onChange: (v: MemberSortBy) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="text-xs text-muted-foreground">並び替え</span>
      <div
        role="radiogroup"
        aria-label="並び替え"
        className="inline-flex flex-wrap items-center rounded-lg border border-border bg-muted p-1"
      >
        {MEMBER_SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`min-h-8 rounded-md px-3.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
              value === opt.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterRow({
  icon: Icon,
  label,
  items,
  selected,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: "true" | "false" }>;
  label: string;
  items: Array<{ value: string | undefined; label: string }>;
  selected: string | undefined;
  onSelect: (v: string | undefined) => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="mt-1.5 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="-mx-1 flex flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
      >
        {items.map((item) => {
          const isSelected =
            (item.value === undefined && !selected) ||
            (item.value === "" && !selected) ||
            item.value === selected;
          return (
            <button
              key={`${item.value}-${item.label}`}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(item.value || undefined)}
              className={`inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
                isSelected
                  ? "border-accent/40 bg-accent/10 text-accent-strong"
                  : "border-border bg-card text-muted-foreground hover:border-accent/30 hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  bookmarked,
  connected,
  pending,
  connectPending,
  bookmarkPending,
  onOpen,
  onToggleBookmark,
  onConnect,
}: {
  member: Profile;
  bookmarked: boolean;
  connected: boolean;
  pending: boolean;
  connectPending: boolean;
  bookmarkPending: boolean;
  onOpen: () => void;
  onToggleBookmark: () => void;
  onConnect: () => void;
}) {
  const stateLabel = connected ? "（接続済み）" : pending ? "（申請中）" : "";

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("button")) return;
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen();
          } else if (e.key === " ") {
            e.preventDefault();
          }
        }}
        onKeyUp={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${member.name} のプロフィールを開く${stateLabel}`}
        className="block w-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <Card className="ds-card-interactive h-full border-l-stripe border-l-transparent transition-[border-color] hover:border-l-accent">
          <CardContent className="space-y-3 pr-9">
            <div className="flex items-start gap-3">
              <UserAvatar name={member.name} avatarUrl={member.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-foreground">
                  {member.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {member.company}
                  {member.position ? ` / ${member.position}` : ""}
                </p>
              </div>
            </div>

            {member.industry && (
              <Badge
                variant="outline"
                className="h-6 border-accent/25 bg-accent/5 px-2.5 text-xs font-medium text-accent-strong"
              >
                {member.industry}
              </Badge>
            )}
            {member.bio && (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {member.bio}
              </p>
            )}

            <div className="flex items-center justify-end pt-1">
              {connected ? (
                <Badge variant="outline" className="badge-success-soft px-2 text-xs font-medium">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  接続済み
                </Badge>
              ) : pending ? (
                <Badge
                  variant="outline"
                  className="border-accent/30 bg-accent/10 px-2 text-xs font-medium text-accent-strong"
                >
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  申請中
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="accent"
                  disabled={connectPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnect();
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  つながる
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleBookmark();
        }}
        disabled={bookmarkPending}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? "ブックマークを解除" : "ブックマークに追加"}
        className={`absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
          bookmarked
            ? "text-accent-strong hover:bg-accent/10"
            : "text-muted-foreground/60 hover:bg-muted hover:text-accent-strong"
        }`}
      >
        <Bookmark
          className="h-4 w-4"
          fill={bookmarked ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pageNumbers = buildPageNumbers(page, totalPages);

  return (
    <nav
      aria-label="ページネーション"
      className="flex items-center justify-center gap-1.5 pt-2"
    >
      <Button
        variant="outline"
        size="icon-sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="前のページ"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      {pageNumbers.map((n, i) =>
        typeof n === "number" ? (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-current={n === page ? "page" : undefined}
            aria-label={`${n}ページ目`}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
              n === page
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {n}
          </button>
        ) : (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-xs text-muted-foreground">
            …
          </span>
        ),
      )}
      <Button
        variant="outline"
        size="icon-sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="次のページ"
      >
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <span className="sr-only">
        全{totalPages}ページ中{page}ページ目
      </span>
    </nav>
  );
}

// 番号付き pagination。両端 + current周辺 + ellipsis
function buildPageNumbers(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const first = 1;
  const last = total;
  const set = new Set<number>([first, last, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => set.add(n));
  const sorted = Array.from(set)
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const result: Array<number | "…"> = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev > 1) result.push("…");
    result.push(n);
  });
  return result;
}

function EmptyState({
  search,
  hasFilter,
  onClear,
}: {
  search: string;
  hasFilter: boolean;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/40 px-6 py-12 text-center">
      <Users className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">
        {search ? "検索結果が見つかりません" : "メンバーがまだいません"}
      </p>
      {hasFilter && (
        <>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            条件を絞りすぎている可能性があります。
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
            条件をクリア
          </Button>
        </>
      )}
    </div>
  );
}
