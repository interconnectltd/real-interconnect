"use client";

import { useState } from "react";
import { Users, Search, Bookmark, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMembers } from "@/hooks/queries/use-members";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { useToggleBookmark } from "@/hooks/mutations/use-toggle-bookmark";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { INDUSTRIES, POSITIONS, MEMBER_SORT_OPTIONS } from "@/lib/constants";
import type { Profile } from "@/types";

export default function MembersPage() {
  const {
    memberSearch, setMemberSearch,
    memberIndustryFilter, setMemberIndustryFilter,
    memberSortBy, setMemberSortBy,
    memberPositionFilter, setMemberPositionFilter,
  } = useFilterStore();
  const [page, setPage] = useState(1);
  const selectedIndustry = memberIndustryFilter[0] ?? undefined;

  const { data, isLoading } = useMembers(memberSearch, {
    industry: selectedIndustry,
    position: memberPositionFilter || undefined,
    sort: memberSortBy,
    page,
  });
  const { data: bookmarksData } = useBookmarks();
  const toggleBookmark = useToggleBookmark();
  const requestConnection = useRequestConnection();
  const { openProfileModal } = useUIStore();

  const bookmarkedIds = new Set(
    (bookmarksData as { bookmarked_user_id: string }[] | undefined)?.map(
      (b) => b.bookmarked_user_id,
    ) ?? [],
  );

  const members = (data as { members: Profile[]; meta: { totalPages: number } } | undefined)?.members;
  const totalPages = (data as { members: Profile[]; meta: { totalPages: number } } | undefined)?.meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">メンバー</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ネットワーク内のプロフェッショナル
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="名前、会社名、自己紹介で検索..."
          value={memberSearch}
          onChange={(e) => {
            setMemberSearch(e.target.value);
            setPage(1);
          }}
          className="pl-9"
        />
      </div>

      {/* Sort options */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">並び替え:</span>
        {MEMBER_SORT_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={memberSortBy === opt.value ? "default" : "outline"}
            size="sm"
            onClick={() => { setMemberSortBy(opt.value); setPage(1); }}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Industry filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <Button
          variant={!selectedIndustry ? "default" : "outline"}
          size="sm"
          onClick={() => { setMemberIndustryFilter([]); setPage(1); }}
        >
          すべて
        </Button>
        {INDUSTRIES.slice(0, 8).map((ind) => (
          <Button
            key={ind}
            variant={selectedIndustry === ind ? "default" : "outline"}
            size="sm"
            onClick={() => { setMemberIndustryFilter([ind]); setPage(1); }}
          >
            {ind}
          </Button>
        ))}
      </div>

      {/* Position filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <Button
          variant={!memberPositionFilter ? "default" : "outline"}
          size="sm"
          onClick={() => { setMemberPositionFilter(""); setPage(1); }}
        >
          全役職
        </Button>
        {POSITIONS.map((pos) => (
          <Button
            key={pos}
            variant={memberPositionFilter === pos ? "default" : "outline"}
            size="sm"
            onClick={() => { setMemberPositionFilter(pos); setPage(1); }}
          >
            {pos}
          </Button>
        ))}
      </div>

      {/* Member list */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : members && members.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <Card
                key={member.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => openProfileModal(member.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {member.company}
                        {member.position ? ` / ${member.position}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const isBookmarked = bookmarkedIds.has(member.id);
                          toggleBookmark.mutate({ userId: member.id, isBookmarked });
                        }}
                        className={bookmarkedIds.has(member.id) ? "text-primary" : "text-muted-foreground hover:text-primary"}
                      >
                        <Bookmark className="h-4 w-4" fill={bookmarkedIds.has(member.id) ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          requestConnection.mutate(member.id);
                        }}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <UserPlus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {member.industry && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      {member.industry}
                    </Badge>
                  )}
                  {member.bio && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {member.bio}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                前へ
              </Button>
              <span className="flex items-center text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                次へ
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {memberSearch ? "検索結果が見つかりません" : "メンバーがまだいません"}
          </p>
        </div>
      )}
    </div>
  );
}
