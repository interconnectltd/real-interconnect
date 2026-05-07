"use client";

import { useMemo } from "react";
import Image from "next/image";
import {
  Heart,
  UserPlus,
  X,
  CheckCircle2,
  Clock,
  Sparkles,
  RotateCcw,
  ArrowUpDown,
  Bookmark,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMatchingScores, useMutualMatches } from "@/hooks/queries/use-matching-scores";
import { useConnections } from "@/hooks/queries/use-connections";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { useToggleBookmark } from "@/hooks/mutations/use-toggle-bookmark";
import { useDismissedUsers } from "@/hooks/use-dismissed-users";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { TldvConnectCta } from "@/components/shared/tldv-connect-cta";
import { ImportRequestCTA } from "@/components/features/import-request/import-request-cta";
import { ScoreBar, ReasonList } from "@/components/shared/score-bar";
import { UserAvatar } from "@/components/shared/user-avatar";
import { toast } from "sonner";
import type { MatchScore, MutualMatch, Connection, ScorePhase } from "@/types";

const PHASE_META: Record<
  ScorePhase,
  { label: string; tone: "neutral" | "accent" | "primary"; description: string }
> = {
  attribute_only: {
    label: "プロフィール一致",
    tone: "neutral",
    description: "プロフィール情報に基づくおすすめ",
  },
  hybrid: {
    label: "会話分析を含む",
    tone: "accent",
    description: "会話分析を組み合わせたおすすめ",
  },
  ai_primary: {
    label: "会話分析（高精度）",
    tone: "primary",
    description: "会話分析に基づく高精度なおすすめ",
  },
};

const phaseToneClass: Record<"neutral" | "accent" | "primary", string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  accent: "border-accent/30 bg-accent/10 text-accent-strong",
  primary: "border-primary/30 bg-primary/10 text-primary",
};

export default function MatchingPage() {
  const { matchingSortBy, setMatchingSortBy } = useFilterStore();
  const { data: scores, isLoading, isError } = useMatchingScores({ sort: matchingSortBy });
  const { data: mutualMatches } = useMutualMatches();
  const { openProfileModal } = useUIStore();
  const requestConnection = useRequestConnection();
  const toggleBookmark = useToggleBookmark();
  const { data: bookmarks } = useBookmarks({ enabled: true });
  const { data: connections } = useConnections();
  const { data: myProfile } = useMyProfile();
  const { dismissedSet, dismiss, restore, resetAll } = useDismissedUsers(myProfile?.id);

  // ── 二重防御フィルタ (Persona W3 / R3 audit) ──
  // Backend の除外漏れに備え、UI 側でも以下を防ぐ:
  //  1. self (自分自身) の混入 — id 一致 or email 完全一致
  //  2. 同一行 (target_id 完全一致) の重複表示 — JOIN 由来の二重列挙を吸収
  //
  // R3 修正: 旧版は name+email 一致を dedup key にしていたため、target_id が
  // 異なる「実在する別個ユーザー」(双子で同名同 email を共用するなど DB 上
  // 起こり得るデータ) を黙ってマージしていた → false positive。
  // dedup key を target_id のみに変更し、name+email の偶発一致は保持する。
  // それでも「同名同 email の複数アカウント」が両方表示される際の混乱を避け
  // られるよう、name+email 完全一致ペアには注意ラベルを別経路で付与する。
  const myId = myProfile?.id;

  const filteredScores = useMemo(() => {
    if (!scores) return scores;
    // PII 漏洩防止のため API レスポンスから email を撤去 (Sec audit Critical /matching)。
    // self / dup 検出は ID と name 正規化のみで実施。同名注意ラベルは name 一致で計上。
    const seenIds = new Set<string>();
    const nameCount = new Map<string, number>();
    const result: Array<MatchScore & { __dupCount?: number }> = [];
    for (const s of scores) {
      if (dismissedSet.has(s.target_id)) continue;
      if (myId && s.target_id === myId) continue;
      if (seenIds.has(s.target_id)) continue;
      seenIds.add(s.target_id);

      const rawName = s.target_profile?.name ?? "";
      const normName = rawName.trim().toLowerCase().replace(/\s+/g, "");
      if (normName) {
        nameCount.set(normName, (nameCount.get(normName) ?? 0) + 1);
      }
      result.push({ ...s });
    }
    // 同名アカウントが 2 件以上ある場合、各カードに __dupCount を付与 (注意喚起)
    return result.map((s) => {
      const rawName = s.target_profile?.name ?? "";
      const normName = rawName.trim().toLowerCase().replace(/\s+/g, "");
      const count = normName ? (nameCount.get(normName) ?? 0) : 0;
      return count > 1 ? { ...s, __dupCount: count - 1 } : s;
    });
  }, [scores, dismissedSet, myId]);

  const filteredMutual = useMemo(() => {
    if (!mutualMatches) return mutualMatches;
    const seenIds = new Set<string>();
    const nameCount = new Map<string, number>();
    const result: Array<MutualMatch & { __dupCount?: number }> = [];
    for (const m of mutualMatches) {
      if (dismissedSet.has(m.user_id)) continue;
      if (myId && m.user_id === myId) continue;
      if (seenIds.has(m.user_id)) continue;
      seenIds.add(m.user_id);

      const rawName = m.profile?.name ?? "";
      const normName = rawName.trim().toLowerCase().replace(/\s+/g, "");
      if (normName) {
        nameCount.set(normName, (nameCount.get(normName) ?? 0) + 1);
      }
      result.push({ ...m });
    }
    return result.map((m) => {
      const rawName = m.profile?.name ?? "";
      const normName = rawName.trim().toLowerCase().replace(/\s+/g, "");
      const count = normName ? (nameCount.get(normName) ?? 0) : 0;
      return count > 1 ? { ...m, __dupCount: count - 1 } : m;
    });
  }, [mutualMatches, dismissedSet, myId]);

  const bookmarkedIds = useMemo(() => {
    if (!Array.isArray(bookmarks)) return new Set<string>();
    return new Set<string>(
      (bookmarks as Array<{ bookmarked_user_id?: string }>)
        .map((b) => b.bookmarked_user_id)
        .filter((v): v is string => typeof v === "string"),
    );
  }, [bookmarks]);

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

  function handleDismiss(id: string) {
    dismiss(id);
    toast.success("この推薦を非表示にしました", {
      action: {
        label: "元に戻す",
        onClick: () => restore(id),
      },
    });
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState onReload={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page header */}
      <div>
        <p className="ds-eyebrow">Recommendation</p>
        <h1 className="ds-h1 mt-1 tracking-tight text-foreground">あなたにおすすめの方</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          プロフィールと会話分析をもとに、つながる価値のある方をご紹介します。
        </p>
      </div>

      {/* Promotional banner — header と list の間に常設 */}
      <Image
        src="/illustrations/banner-matching-promo.png"
        alt=""
        width={1200}
        height={300}
        className="h-auto w-full"
        aria-hidden="true"
        priority={false}
      />

      {/* Mutual matches */}
      {filteredMutual && filteredMutual.length > 0 && (
        <section data-tour="matching-mutual" className="space-y-4">
          {/* Mutual section の意味を可視化する hero (3 cards parallax) */}
          <Image
            src="/illustrations/hero-matching-discovery.png"
            alt=""
            width={1200}
            height={240}
            className="h-auto w-full"
            aria-hidden="true"
            priority={false}
          />
          <header>
            <p className="ds-eyebrow">Mutual</p>
            <span className="ds-eyebrow-rule" aria-hidden="true" />
            <h2 className="ds-h2 mt-2 tracking-tight text-foreground">相互におすすめ</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              お互いにとって価値のあるつながりです
            </p>
          </header>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredMutual.map((m: MutualMatch & { __dupCount?: number }) => {
              const isSelf = !!myId && m.user_id === myId;
              return (
                <MutualCard
                  key={m.user_id}
                  match={m}
                  connected={connectedIds.has(m.user_id)}
                  pending={pendingIds.has(m.user_id)}
                  connectPending={requestConnection.isPending}
                  bookmarked={!isSelf && bookmarkedIds.has(m.user_id)}
                  bookmarkPending={toggleBookmark.isPending}
                  isSelf={isSelf}
                  dupCount={m.__dupCount ?? 0}
                  onOpen={() => {
                    if (isSelf) return;
                    openProfileModal(m.user_id);
                  }}
                  onConnect={() => requestConnection.mutate(m.user_id)}
                  onToggleBookmark={() =>
                    toggleBookmark.mutate({
                      userId: m.user_id,
                      isBookmarked: bookmarkedIds.has(m.user_id),
                    })
                  }
                  onDismiss={() => handleDismiss(m.user_id)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Sort segmented control */}
      <div data-tour="matching-sort">
        <SortToggle value={matchingSortBy} onChange={setMatchingSortBy} />
      </div>

      {/* Score cards */}
      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      ) : filteredScores && filteredScores.length > 0 ? (
        <div className="space-y-4">
          {filteredScores.map((score: MatchScore & { __dupCount?: number }, i: number) => {
            const isSelf = !!myId && score.target_id === myId;
            return (
              <div key={score.target_id} data-tour={i === 0 ? "matching-card-first" : undefined}>
                <ScoreCard
                  score={score}
                  connected={connectedIds.has(score.target_id)}
                  pending={pendingIds.has(score.target_id)}
                  connectPending={requestConnection.isPending}
                  bookmarked={!isSelf && bookmarkedIds.has(score.target_id)}
                  bookmarkPending={toggleBookmark.isPending}
                  isSelf={isSelf}
                  dupCount={score.__dupCount ?? 0}
                  onOpen={() => {
                    if (isSelf) return;
                    openProfileModal(score.target_id);
                  }}
                  onConnect={() => requestConnection.mutate(score.target_id)}
                  onToggleBookmark={() =>
                    toggleBookmark.mutate({
                      userId: score.target_id,
                      isBookmarked: bookmarkedIds.has(score.target_id),
                    })
                  }
                  onDismiss={() => handleDismiss(score.target_id)}
                />
              </div>
            );
          })}
          <TldvConnectCta />
        </div>
      ) : (
        <div className="space-y-4">
          <EmptyState hasMyProfile={!!myProfile} />
          <TldvConnectCta />
          <ImportRequestCTA />
        </div>
      )}

      {/* Reset dismissed */}
      {dismissedSet.size > 0 && (
        <div className="pt-2 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetAll();
              toast.success("非表示を解除しました");
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            非表示にした推薦を元に戻す ({dismissedSet.size}件)
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────── Subcomponents ───────── */

function SortToggle({
  value,
  onChange,
}: {
  value: "score" | "recent";
  onChange: (v: "score" | "recent") => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="text-xs text-muted-foreground">並び替え</span>
      <div
        role="radiogroup"
        aria-label="並び替え"
        className="inline-flex items-center rounded-lg border border-border bg-muted p-1"
      >
        <SortRadio selected={value === "score"} onClick={() => onChange("score")}>
          おすすめ順
        </SortRadio>
        <SortRadio selected={value === "recent"} onClick={() => onChange("recent")}>
          新着順
        </SortRadio>
      </div>
    </div>
  );
}

function SortRadio({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`min-h-[32px] rounded-md px-3.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
        selected
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function MutualCard({
  match,
  connected,
  pending,
  connectPending,
  bookmarked,
  bookmarkPending,
  isSelf = false,
  dupCount = 0,
  onOpen,
  onConnect,
  onToggleBookmark,
  onDismiss,
}: {
  match: MutualMatch;
  connected: boolean;
  pending: boolean;
  connectPending: boolean;
  bookmarked: boolean;
  bookmarkPending: boolean;
  isSelf?: boolean;
  dupCount?: number;
  onOpen: () => void;
  onConnect: () => void;
  onToggleBookmark: () => void;
  onDismiss: () => void;
}) {
  const p = match.profile;
  const name = p?.name ?? "ユーザー";
  const stateLabel = isSelf
    ? "（本人）"
    : connected
      ? "（接続済み）"
      : pending
        ? "（申請中）"
        : "";

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={isSelf ? -1 : 0}
        aria-disabled={isSelf || undefined}
        onClick={isSelf ? undefined : onOpen}
        onKeyDown={(e) => {
          if (isSelf) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen();
          } else if (e.key === " ") {
            e.preventDefault(); // ARIA APG: Space は preventDefault のみ
          }
        }}
        onKeyUp={(e) => {
          if (isSelf) return;
          if (e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${name} のプロフィールを開く${stateLabel}`}
        className={`block w-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
          isSelf ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <Card className="ds-card-interactive h-full overflow-hidden border-accent/25 bg-[color:color-mix(in_oklab,var(--accent)_4%,var(--card))]">
          {/* Mutual の特別感を出す上端 accent 帯 */}
          <Image
            src="/illustrations/mutual-match-accent.png"
            alt=""
            width={800}
            height={120}
            className="-mt-px h-6 w-full object-cover object-center"
            aria-hidden="true"
            priority={false}
          />
          <CardContent className="space-y-3 pr-24">
            <div className="flex items-start gap-3">
              <UserAvatar name={p?.name} avatarUrl={p?.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate text-base font-medium text-foreground">{name}</p>
                  {isSelf && (
                    <Badge
                      variant="outline"
                      className="h-5 border-destructive/30 bg-destructive/10 px-2 text-[11px] font-medium text-destructive"
                    >
                      本人
                    </Badge>
                  )}
                  {dupCount > 0 && (
                    <span
                      className="text-[11px] text-muted-foreground"
                      title="同じ氏名・連絡先のアカウントが他にも見つかりました。別人の可能性もありますのでご注意ください。"
                    >
                      （同名同連絡先 他{dupCount}件）
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {p?.company}
                  {p?.position ? ` / ${p.position}` : ""}
                </p>
              </div>
            </div>
            {match.my_reasons?.length > 0 && (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {match.my_reasons[0]}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <Badge
                variant="outline"
                className="border-accent/30 bg-accent/10 px-2.5 text-[11px] font-semibold text-accent-strong"
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                相互おすすめ
              </Badge>
              <ConnectControl
                connected={connected}
                pending={pending}
                disabled={connectPending}
                onConnect={onConnect}
                size="sm"
              />
            </div>
          </CardContent>
        </Card>
      </div>
      {!isSelf && (
        <BookmarkButton
          bookmarked={bookmarked}
          pending={bookmarkPending}
          onClick={onToggleBookmark}
        />
      )}
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

function ScoreCard({
  score,
  connected,
  pending,
  connectPending,
  bookmarked,
  bookmarkPending,
  isSelf = false,
  dupCount = 0,
  onOpen,
  onConnect,
  onToggleBookmark,
  onDismiss,
}: {
  score: MatchScore;
  connected: boolean;
  pending: boolean;
  connectPending: boolean;
  bookmarked: boolean;
  bookmarkPending: boolean;
  isSelf?: boolean;
  dupCount?: number;
  onOpen: () => void;
  onConnect: () => void;
  onToggleBookmark: () => void;
  onDismiss: () => void;
}) {
  const p = score.target_profile;
  const phase = PHASE_META[score.phase];
  const lowConfidence = score.confidence < 0.3;
  const preliminary = score.confidence < 0.5;
  const matchPct = Math.round(score.total_score * 100);
  const name = p?.name ?? "ユーザー";
  const stateLabel = isSelf
    ? "（本人）"
    : connected
      ? "（接続済み）"
      : pending
        ? "（申請中）"
        : "";

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={isSelf ? -1 : 0}
        aria-disabled={isSelf || undefined}
        onClick={isSelf ? undefined : onOpen}
        onKeyDown={(e) => {
          if (isSelf) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen();
          } else if (e.key === " ") {
            e.preventDefault(); // ARIA APG: Space は preventDefault のみ
          }
        }}
        onKeyUp={(e) => {
          if (isSelf) return;
          if (e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${name} のプロフィールを開く${stateLabel}`}
        className={`block w-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
          isSelf ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <Card className="ds-card-interactive">
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 pr-24">
              <UserAvatar name={p?.name} avatarUrl={p?.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate text-base font-medium text-foreground">{name}</p>
                  {isSelf && (
                    <Badge
                      variant="outline"
                      className="h-5 border-destructive/30 bg-destructive/10 px-2 text-[11px] font-medium text-destructive"
                    >
                      本人
                    </Badge>
                  )}
                  {p?.industry && (
                    <Badge
                      variant="outline"
                      className="h-5 border-accent/25 bg-accent/5 px-2 text-[11px] font-medium text-accent-strong"
                    >
                      {p.industry}
                    </Badge>
                  )}
                  {dupCount > 0 && (
                    <span
                      className="text-[11px] text-muted-foreground"
                      title="同じ氏名・連絡先のアカウントが他にも見つかりました。別人の可能性もありますのでご注意ください。"
                    >
                      （同名同連絡先 他{dupCount}件）
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {p?.company}
                  {p?.position ? ` / ${p.position}` : ""}
                </p>
              </div>
              {!isSelf && (
                <ConnectControl
                  connected={connected}
                  pending={pending}
                  disabled={connectPending}
                  onConnect={onConnect}
                  size="sm"
                />
              )}
            </div>

            <ReasonList reasons={score.reasons ?? []} />

            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">マッチ度</span>
                <span className="text-xl font-bold tabular-nums text-foreground">
                  {matchPct}%
                </span>
              </div>
              <ScoreBar label="おすすめ度" score={score.total_score} preliminary={preliminary} />
              <div className="flex items-center justify-between gap-3 pt-1">
                <Badge
                  variant="outline"
                  className={`px-2 text-[11px] font-medium ${phaseToneClass[phase.tone]}`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-current"
                  />
                  {phase.label}
                </Badge>
                <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
                  {phase.description}
                </p>
              </div>
              {lowConfidence && (
                <p className="text-[11px] text-muted-foreground">
                  会話分析が増えると精度が向上します
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {!isSelf && (
        <BookmarkButton
          bookmarked={bookmarked}
          pending={bookmarkPending}
          onClick={onToggleBookmark}
        />
      )}
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

function ConnectControl({
  connected,
  pending,
  disabled,
  onConnect,
  size = "sm",
}: {
  connected: boolean;
  pending: boolean;
  disabled: boolean;
  onConnect: () => void;
  size?: "sm";
}) {
  if (connected) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-primary/30 bg-primary/10 px-2 text-[11px] font-medium text-primary"
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        接続済み
      </Badge>
    );
  }
  if (pending) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-accent/30 bg-accent/10 px-2 text-[11px] font-medium text-accent-strong"
      >
        <Clock className="h-3 w-3" aria-hidden="true" />
        申請中
      </Badge>
    );
  }
  return (
    <Button
      type="button"
      size={size}
      variant="accent"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onConnect();
      }}
      className="shrink-0"
    >
      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
      つながる
    </Button>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label="この推薦を非表示にする"
      className="absolute right-1.5 top-1.5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function BookmarkButton({
  bookmarked,
  pending,
  onClick,
}: {
  bookmarked: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={pending}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "保存を解除" : "後で見るために保存"}
      className={`absolute right-14 top-1.5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:opacity-50 ${
        bookmarked
          ? "text-accent-strong hover:bg-muted"
          : "text-muted-foreground/60 hover:bg-muted hover:text-foreground"
      }`}
    >
      <Bookmark
        className="h-3.5 w-3.5"
        fill={bookmarked ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
}

function EmptyState({ hasMyProfile = true }: { hasMyProfile?: boolean }) {
  return (
    <div className="ds-empty-state">
      <Image
        src="/illustrations/empty-matching.png"
        alt=""
        width={400}
        height={240}
        className="mx-auto h-auto w-full max-w-[360px]"
        aria-hidden="true"
        priority={false}
      />
      <p className="mt-3 text-sm font-medium text-foreground">
        {hasMyProfile ? "おすすめを準備しています" : "おすすめはまだありません"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        会話分析を増やすと、より的確なおすすめが表示されます。プロフィールの充実もおすすめ精度を高めます。
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button variant="accent" size="sm" render={<a href="/meetings" />}>
          会話分析を増やす
        </Button>
        <Button variant="outline" size="sm" render={<a href="/members" />}>
          メンバー一覧を見る
        </Button>
      </div>
    </div>
  );
}

function ErrorState({ onReload }: { onReload: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-10 text-center">
      <p className="text-sm font-medium text-destructive">データの取得に失敗しました</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onReload}>
        再読み込み
      </Button>
    </div>
  );
}
