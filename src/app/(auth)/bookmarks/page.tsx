"use client";

/**
 * /bookmarks
 *
 * 自分が保存したメンバーの一覧。/members の Bookmark トグルや profile-modal の星から
 * 追加された相手を時系列降順で表示。各行クリックで profile modal を開く + 一括解除。
 */

import { useMemo } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { useToggleBookmark } from "@/hooks/mutations/use-toggle-bookmark";
import { useUIStore } from "@/stores/ui-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/user-avatar";

interface BookmarkRow {
  id: string;
  bookmarked_user_id: string;
  note: string | null;
  created_at: string;
  profile: {
    id: string;
    name: string;
    company: string | null;
    position: string | null;
    industry: string | null;
    bio: string | null;
    avatar_url: string | null;
  } | null;
}

export default function BookmarksPage() {
  const { data, isLoading, isError } = useBookmarks({ enabled: true });
  const toggle = useToggleBookmark();
  const { openProfileModal } = useUIStore();

  const items = useMemo(() => {
    if (!Array.isArray(data)) return [] as BookmarkRow[];
    return (data as BookmarkRow[]).filter((b) => b.profile);
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="ds-eyebrow">Saved</p>
        <h1 className="ds-h1 mt-1 tracking-tight text-foreground">保存したメンバー</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          後で確認したい方をストックしておけます。気になる方を見つけたら、メンバーカードや
          おすすめ画面のしおりアイコンから保存できます。
        </p>
      </header>

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
          読み込みに失敗しました。再読み込みしてください。
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-lg border bg-card px-6 py-16 text-center">
          <Bookmark
            className="mx-auto h-8 w-8 text-muted-foreground/40"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-foreground">
            まだ保存したメンバーはいません
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            メンバー一覧やマッチング画面の<strong>右上のしおりアイコン</strong>を
            タップすると、ここに保存されます。
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button variant="accent" size="sm" render={<a href="/matching" />}>
              マッチング画面へ
            </Button>
            <Button variant="outline" size="sm" render={<a href="/members" />}>
              メンバー一覧へ
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="grid gap-3 list-none p-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b) => {
            const p = b.profile!;
            return (
              <li key={b.id}>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => openProfileModal(p.id)}
                    aria-label={`${p.name} のプロフィールを開く`}
                    className="block w-full rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                  >
                    <Card className="ds-card-interactive h-full">
                      <CardContent className="space-y-2 pr-12">
                        <div className="flex items-start gap-3">
                          <UserAvatar
                            name={p.name}
                            avatarUrl={p.avatar_url}
                            size="md"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-medium text-foreground">
                              {p.name}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {[p.company, p.position]
                                .filter(Boolean)
                                .join(" / ") || "—"}
                            </p>
                            {p.industry && (
                              <Badge
                                variant="outline"
                                className="mt-1.5 h-5 border-accent/25 bg-accent/5 px-2 text-[11px] font-medium text-accent-strong"
                              >
                                {p.industry}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {b.note && (
                          <p className="rounded bg-muted/40 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
                            {b.note}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70">
                          {new Date(b.created_at).toLocaleDateString("ja-JP")} に保存
                        </p>
                      </CardContent>
                    </Card>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle.mutate({
                        userId: p.id,
                        isBookmarked: true,
                      });
                    }}
                    disabled={toggle.isPending}
                    aria-label={`${p.name} の保存を解除`}
                    className="absolute right-1.5 top-1.5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-accent-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                  >
                    <Bookmark
                      className="h-4 w-4"
                      fill="currentColor"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
