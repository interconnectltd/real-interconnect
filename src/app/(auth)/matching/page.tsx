"use client";

import { Heart, UserPlus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMatchingScores, useMutualMatches } from "@/hooks/queries/use-matching-scores";
import { useConnections } from "@/hooks/queries/use-connections";
import { useRequestConnection } from "@/hooks/mutations/use-request-connection";
import { useDismissedUsers } from "@/hooks/use-dismissed-users";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { scoreLabel } from "@/lib/constants";
import { TldvConnectCta } from "@/components/shared/tldv-connect-cta";
import { ScoreBar, ReasonList } from "@/components/shared/score-bar";
import { toast } from "sonner";
import type { MatchScore, MutualMatch, Profile, Connection } from "@/types";

export default function MatchingPage() {
  const { matchingSortBy, setMatchingSortBy } = useFilterStore();
  const { data: scores, isLoading } = useMatchingScores({ sort: matchingSortBy });
  const { data: mutualMatches } = useMutualMatches();
  const { openProfileModal } = useUIStore();
  const requestConnection = useRequestConnection();
  const { data: connections } = useConnections();
  const { data: myProfile } = useMyProfile();
  const { dismissedSet, dismiss, resetAll } = useDismissedUsers(myProfile?.id);

  // Filter out dismissed users
  const filteredScores = scores?.filter((s: MatchScore) => !dismissedSet.has(s.target_id));
  const filteredMutual = mutualMatches?.filter((m: MutualMatch) => !dismissedSet.has(m.user_id));

  // 接続済み（accepted / reaccepted）のユーザーIDセット
  const connectedIds = new Set(
    (connections as Connection[] | undefined)
      ?.filter((c) => c.status === "accepted" || c.status === "reaccepted")
      .flatMap((c) => [c.user_id, c.connected_user_id]) ?? [],
  );

  // 申請中（pending）のユーザーIDセット
  const pendingIds = new Set(
    (connections as Connection[] | undefined)
      ?.filter((c) => c.status === "pending")
      .flatMap((c) => [c.user_id, c.connected_user_id]) ?? [],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">あなたにおすすめの方</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          プロフィールとミーティング分析をもとに、つながる価値のある方をご紹介します
        </p>
      </div>

      {/* Mutual matches */}
      {filteredMutual && filteredMutual.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-primary">相互におすすめ</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            お互いにとって価値のあるつながりです
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredMutual.map((m: MutualMatch) => {
              const p = m.profile;
              return (
                <Card
                  key={m.user_id}
                  className="relative cursor-pointer border-primary/20 bg-primary/5 transition-shadow hover:shadow-md"
                  onClick={() => openProfileModal(m.user_id)}
                >
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                    aria-label="この推薦を非表示にする"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismiss(m.user_id);
                      toast.success("この推薦を非表示にしました");
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <CardContent className="p-4 pr-8">
                    <p className="font-medium">{p?.name ?? "ユーザー"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p?.company}{p?.position ? ` / ${p.position}` : ""}
                    </p>
                    {m.my_reasons?.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {m.my_reasons[0]}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Sort */}
      <div className="flex gap-2">
        <Button
          variant={matchingSortBy === "score" ? "default" : "outline"}
          size="sm"
          onClick={() => setMatchingSortBy("score")}
        >
          おすすめ順
        </Button>
        <Button
          variant={matchingSortBy === "recent" ? "default" : "outline"}
          size="sm"
          onClick={() => setMatchingSortBy("recent")}
        >
          新着順
        </Button>
      </div>

      {/* Score cards */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : filteredScores && filteredScores.length > 0 ? (
        <div className="space-y-4">
          {filteredScores.map((score: MatchScore) => {
            const p = score.target_profile;
            return (
              <Card
                key={score.target_id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => openProfileModal(score.target_id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">
                        {p?.name ?? "ユーザー"}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {p?.company}{p?.position ? ` / ${p.position}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                    {connectedIds.has(score.target_id) ? (
                      <Badge variant="secondary" className="text-xs">接続済み</Badge>
                    ) : pendingIds.has(score.target_id) ? (
                      <Badge variant="outline" className="text-xs">申請中</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={requestConnection.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          requestConnection.mutate(score.target_id);
                        }}
                      >
                        <UserPlus className="mr-1 h-3.5 w-3.5" />
                        つながる
                      </Button>
                    )}
                    <button
                      type="button"
                      className="rounded-full p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                      aria-label="この推薦を非表示にする"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(score.target_id);
                        toast.success("この推薦を非表示にしました");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    </div>
                  </div>
                  {p?.industry && (
                    <Badge variant="secondary" className="mt-1 w-fit text-xs">
                      {p.industry}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Reasons (primary display) */}
                  <ReasonList reasons={score.reasons ?? []} />

                  {/* Score bar — おすすめ度 */}
                  <div className="space-y-2 pt-2">
                    <ScoreBar
                      label="おすすめ度"
                      score={score.total_score}
                      preliminary={score.confidence < 0.5}
                    />
                    {score.confidence < 0.3 && (
                      <p className="text-xs text-muted-foreground/50">
                        ミーティング分析が増えると精度が向上します
                      </p>
                    )}
                  </div>

                  {/* Phase indicator */}
                  {score.phase === "attribute_only" && (
                    <p className="text-xs text-muted-foreground/60">
                      プロフィール情報に基づくおすすめです
                    </p>
                  )}
                  {score.phase === "hybrid" && (
                    <p className="text-xs text-muted-foreground/60">
                      ミーティング分析を含むおすすめです
                    </p>
                  )}
                  {score.phase === "ai_primary" && (
                    <p className="text-xs text-muted-foreground/60">
                      ミーティング分析に基づく高精度なおすすめです
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <TldvConnectCta />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Heart className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">
              おすすめを準備しています
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              プロフィールを充実させると、より的確なおすすめが表示されます
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              render={<a href="/members" />}
            >
              メンバー一覧を見る
            </Button>
          </div>
          <TldvConnectCta />
        </div>
      )}

      {/* Reset dismissed recommendations */}
      {dismissedSet.size > 0 && (
        <div className="pt-2 text-center">
          <button
            type="button"
            className="text-xs text-muted-foreground underline hover:text-foreground"
            onClick={() => {
              resetAll();
              toast.success("非表示を解除しました");
            }}
          >
            非表示にした推薦を元に戻す ({dismissedSet.size}件)
          </button>
        </div>
      )}
    </div>
  );
}
