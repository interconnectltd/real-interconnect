"use client";

import { useEffect, useState } from "react";
import { Heart, Users, Bell, UserCheck, Zap, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSupabase } from "@/providers/supabase-provider";
import { useConnections } from "@/hooks/queries/use-connections";
import { useUnreadCount } from "@/hooks/queries/use-notifications";
import { useMatchingScores, useMutualMatches } from "@/hooks/queries/use-matching-scores";
import { useMembers } from "@/hooks/queries/use-members";
import { useUIStore } from "@/stores/ui-store";
import { useAnalysisCount } from "@/hooks/queries/use-ai-profile";
import { TldvConnectCta } from "@/components/shared/tldv-connect-cta";
import { ProfileCompleteness } from "@/components/shared/profile-completeness";
import { api } from "@/lib/api-client";
import { useMyProfile } from "@/hooks/queries/use-profile";
import type { MutualMatch, Profile } from "@/types";

export default function DashboardPage() {
  const { user } = useSupabase();
  const queryClient = useQueryClient();
  const [computeDone, setComputeDone] = useState(false);
  const { data: myProfile } = useMyProfile();
  const { data: connections, isLoading: isLoadingConnections } = useConnections();
  const { data: unreadCount, isLoading: isLoadingUnread } = useUnreadCount();
  const { data: scores, isLoading: isLoadingScores } = useMatchingScores({});
  const { data: mutualMatches } = useMutualMatches();
  const { data: membersData } = useMembers("", { page: 1 });
  const { openProfileModal } = useUIStore();

  // 初回ログイン時のみスコア計算をトリガー（sessionStorage で重複防止）
  useEffect(() => {
    if (!user) return;
    const key = `interconnect_computed_${user.id}`;
    if (sessionStorage.getItem(key)) {
      setComputeDone(true);
      return;
    }
    api
      .post<{ computed: number }>("/matching/compute-v2")
      .then((res) => {
        sessionStorage.setItem(key, "1");
        if (res.computed > 0) {
          queryClient.invalidateQueries({ queryKey: ["matching"] });
        }
      })
      .catch(() => {})
      .finally(() => setComputeDone(true));
  }, [user, queryClient]);

  const acceptedCount = connections?.filter(
    (c: { status: string }) => c.status === "accepted",
  ).length ?? 0;
  const memberCount =
    (membersData as { members: unknown[]; meta: { totalCount: number } } | undefined)
      ?.meta?.totalCount ?? 0;
  const matchCount = scores?.length ?? 0;

  // 成熟度 (設計書 1-08)
  const { data: analysisCount = 0 } = useAnalysisCount();
  const maturityLevel = analysisCount === 0 ? 1 : analysisCount <= 4 ? 2 : 3;
  const nextLevelAt = maturityLevel === 1 ? 1 : maturityLevel === 2 ? 5 : null;
  const remaining = nextLevelAt ? nextLevelAt - analysisCount : 0;

  const stats = [
    { label: "コネクション", value: acceptedCount, icon: UserCheck, color: "text-primary", href: "/connections" },
    { label: "未読通知", value: unreadCount ?? 0, icon: Bell, color: "text-accent", href: "/notifications" },
    { label: "おすすめ", value: matchCount, icon: Heart, color: "text-primary", href: "/matching" },
    { label: "メンバー", value: memberCount, icon: Users, color: "text-muted-foreground", href: "/members" },
  ];

  const isLoading = isLoadingConnections || isLoadingUnread || isLoadingScores;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ダッシュボード</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            あなたのネットワーク状況の概要
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => queryClient.invalidateQueries()}
          title="更新"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 成熟度プログレス (設計書 1-08) */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">おすすめ精度: Lv{maturityLevel}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {maturityLevel === 3
                  ? "最高精度のAI分析に基づくおすすめです"
                  : `あと${remaining}回のミーティング分析で精度がアップします`}
              </p>
            </div>
            <Zap className="h-5 w-5 text-accent" />
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${maturityLevel === 3 ? 100 : nextLevelAt ? (analysisCount / nextLevelAt) * 100 : 0}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* プロフィール完成度メーター (A16) */}
      {myProfile && <ProfileCompleteness profile={myProfile} />}

      {/* おすすめマッチング Top 3 */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">おすすめの方</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              プロフィール情報をもとにご紹介します
            </p>
          </div>
          {(scores?.length ?? 0) > 0 && (
            <Button variant="outline" size="sm" render={<Link href="/matching" />}>
              すべて見る
            </Button>
          )}
        </div>

        {scores && scores.length > 0 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scores.slice(0, 3).map((score) => {
              const p = score.target_profile;
              return (
                <Card
                  key={score.target_id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => openProfileModal(score.target_id)}
                >
                  <CardContent className="p-4">
                    <p className="font-medium">{p?.name ?? "ユーザー"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p?.company}{p?.position ? ` / ${p.position}` : ""}
                    </p>
                    {score.reasons?.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {score.reasons[0]}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Heart className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                おすすめを準備しています...
              </p>
            </div>
            <TldvConnectCta />
          </div>
        )}
      </div>

      {/* 相互おすすめ */}
      {mutualMatches && mutualMatches.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-primary">相互におすすめ</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mutualMatches.slice(0, 3).map((m: MutualMatch) => (
              <Card
                key={m.user_id}
                className="cursor-pointer border-primary/20 bg-primary/5 transition-shadow hover:shadow-md"
                onClick={() => openProfileModal(m.user_id)}
              >
                <CardContent className="p-4">
                  <p className="font-medium">{m.profile?.name ?? "ユーザー"}</p>
                  {m.my_reasons?.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {m.my_reasons[0]}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 新着メンバー — Day 2+ のリテンション */}
      <NewMembersSection onViewProfile={openProfileModal} />
    </div>
  );
}

function NewMembersSection({ onViewProfile }: { onViewProfile: (id: string) => void }) {
  const { data } = useMembers("", { page: 1 });
  const members = (data as { members: Profile[]; meta: unknown } | undefined)?.members;

  // 直近7日以内の登録者のみ
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newMembers = members?.filter(
    (m) => new Date(m.created_at).getTime() > sevenDaysAgo,
  );

  if (!newMembers?.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">最近参加した方</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            この1週間で新しく参加したメンバー
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/members" />}>
          メンバー一覧
        </Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {newMembers.slice(0, 6).map((member) => (
          <Card
            key={member.id}
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => onViewProfile(member.id)}
          >
            <CardContent className="p-4">
              <p className="font-medium">{member.name}</p>
              <p className="text-xs text-muted-foreground">
                {member.company}{member.position ? ` / ${member.position}` : ""}
              </p>
              {member.industry && (
                <Badge variant="secondary" className="mt-1 text-xs">
                  {member.industry}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
