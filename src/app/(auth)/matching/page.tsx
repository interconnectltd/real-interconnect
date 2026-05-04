"use client";

import { useMemo } from "react";
import {
  Heart,
  UserPlus,
  X,
  CheckCircle2,
  Clock,
  Sparkles,
  RotateCcw,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMatchingScores, useMutualMatches } from "@/hooks/queries/use-matching-scores";
import { useConnections } from "@/hooks/queries/use-connections";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useDismissedUsers } from "@/hooks/use-dismissed-users";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { TldvConnectCta } from "@/components/shared/tldv-connect-cta";
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
  const { data: connections } = useConnections();
  const { data: myProfile } = useMyProfile();
  const { dismissedSet, dismiss, restore, resetAll } = useDismissedUsers(myProfile?.id);

  const filteredScores = useMemo(
    () => scores?.filter((s: MatchScore) => !dismissedSet.has(s.target_id)),
    [scores, dismissedSet],
  );
  const filteredMutual = useMemo(
    () => mutualMatches?.filter((m: MutualMatch) => !dismissedSet.has(m.user_id)),
    [mutualMatches, dismissedSet],
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

      {/* Mutual matches */}
      {filteredMutual && filteredMutual.length > 0 && (
        <section className="space-y-4">
          <header>
            <p className="ds-eyebrow">Mutual</p>
            <span className="ds-eyebrow-rule" aria-hidden="true" />
            <h2 className="ds-h2 mt-2 tracking-tight text-foreground">相互におすすめ</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              お互いにとって価値のあるつながりです
            </p>
          </header>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredMutual.map((m: MutualMatch) => (
              <MutualCard
                key={m.user_id}
                match={m}
                connected={connectedIds.has(m.user_id)}
                pending={pendingIds.has(m.user_id)}
                connectPending={requestConnection.isPending}
                onOpen={() => openProfileModal(m.user_id)}
                onConnect={() => requestConnection.mutate(m.user_id)}
                onDismiss={() => handleDismiss(m.user_id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Sort segmented control */}
      <SortToggle value={matchingSortBy} onChange={setMatchingSortBy} />

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
          {filteredScores.map((score: MatchScore) => (
            <ScoreCard
              key={score.target_id}
              score={score}
              connected={connectedIds.has(score.target_id)}
              pending={pendingIds.has(score.target_id)}
              connectPending={requestConnection.isPending}
              onOpen={() => openProfileModal(score.target_id)}
              onConnect={() => requestConnection.mutate(score.target_id)}
              onDismiss={() => handleDismiss(score.target_id)}
            />
          ))}
          <TldvConnectCta />
        </div>
      ) : (
        <div className="space-y-4">
          <EmptyState />
          <TldvConnectCta />
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
  onOpen,
  onConnect,
  onDismiss,
}: {
  match: MutualMatch;
  connected: boolean;
  pending: boolean;
  connectPending: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  const p = match.profile;
  const name = p?.name ?? "ユーザー";
  const stateLabel = connected ? "（接続済み）" : pending ? "（申請中）" : "";

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen();
          } else if (e.key === " ") {
            e.preventDefault(); // ARIA APG: Space は preventDefault のみ
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${name} のプロフィールを開く${stateLabel}`}
        className="block w-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <Card className="ds-card-interactive relative h-full overflow-hidden border-accent/25 bg-[color:color-mix(in_oklab,var(--accent)_4%,var(--card))]">
          <span aria-hidden="true" className="ds-card-stripe" />
          <CardContent className="space-y-3 pl-5 pr-9">
            <div className="flex items-start gap-3">
              <UserAvatar name={p?.name} avatarUrl={p?.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-foreground">{name}</p>
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
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

function ScoreCard({
  score,
  connected,
  pending,
  connectPending,
  onOpen,
  onConnect,
  onDismiss,
}: {
  score: MatchScore;
  connected: boolean;
  pending: boolean;
  connectPending: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  const p = score.target_profile;
  const phase = PHASE_META[score.phase];
  const lowConfidence = score.confidence < 0.3;
  const preliminary = score.confidence < 0.5;
  const matchPct = Math.round(score.total_score * 100);
  const name = p?.name ?? "ユーザー";
  const stateLabel = connected ? "（接続済み）" : pending ? "（申請中）" : "";

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen();
          } else if (e.key === " ") {
            e.preventDefault(); // ARIA APG: Space は preventDefault のみ
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${name} のプロフィールを開く${stateLabel}`}
        className="block w-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <Card className="ds-card-interactive">
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 pr-9">
              <UserAvatar name={p?.name} avatarUrl={p?.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate text-base font-medium text-foreground">{name}</p>
                  {p?.industry && (
                    <Badge
                      variant="outline"
                      className="h-5 border-accent/25 bg-accent/5 px-2 text-[11px] font-medium text-accent-strong"
                    >
                      {p.industry}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {p?.company}
                  {p?.position ? ` / ${p.position}` : ""}
                </p>
              </div>
              <ConnectControl
                connected={connected}
                pending={pending}
                disabled={connectPending}
                onConnect={onConnect}
                size="sm"
              />
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
      className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function EmptyState() {
  return (
    <div className="ds-empty-state">
      <Heart className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">おすすめを準備しています</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        プロフィールを充実させると、より的確なおすすめが表示されます。
      </p>
      <Button variant="outline" size="sm" className="mt-4" render={<a href="/members" />}>
        メンバー一覧を見る
      </Button>
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
