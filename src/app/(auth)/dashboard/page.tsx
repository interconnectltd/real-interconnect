"use client";

import { useEffect, useRef } from "react";
import {
  Heart,
  Users,
  Bell,
  UserCheck,
  Sparkles,
  RefreshCw,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/user-avatar";
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
import type { LucideIcon } from "lucide-react";
import type { MutualMatch, Profile } from "@/types";

interface Stat {
  label: string;
  value: number;
  icon: LucideIcon;
  href: string;
  hint: string;
  /** 0値時に出すマイクロコピー (なければ hint をそのまま使用) */
  zeroHint?: string;
}

export default function DashboardPage() {
  const { user } = useSupabase();
  const queryClient = useQueryClient();
  const computedRef = useRef(false);
  const { data: myProfile } = useMyProfile();
  const { data: connections, isLoading: isLoadingConnections } = useConnections();
  const { data: unreadCount, isLoading: isLoadingUnread } = useUnreadCount();
  const { data: scores, isLoading: isLoadingScores } = useMatchingScores({});
  const { data: mutualMatches } = useMutualMatches();
  const { data: membersData } = useMembers("", { page: 1 });
  const { openProfileModal } = useUIStore();

  useEffect(() => {
    if (!user || computedRef.current) return;
    const key = `interconnect_computed_${user.id}`;
    if (sessionStorage.getItem(key)) {
      computedRef.current = true;
      return;
    }
    computedRef.current = true;
    api
      .post<{ computed: number }>("/matching/compute-v2")
      .then((res) => {
        sessionStorage.setItem(key, "1");
        if (res.computed > 0) {
          queryClient.invalidateQueries({ queryKey: ["matching"] });
        }
      })
      .catch(() => {});
  }, [user, queryClient]);

  const acceptedCount = connections?.filter(
    (c: { status: string }) => c.status === "accepted",
  ).length ?? 0;
  const memberCount =
    (membersData as { members: unknown[]; meta: { totalCount: number } } | undefined)
      ?.meta?.totalCount ?? 0;
  const matchCount = scores?.length ?? 0;

  const { data: analysisCount = 0 } = useAnalysisCount();
  const maturityLevel = analysisCount === 0 ? 1 : analysisCount <= 4 ? 2 : 3;
  const nextLevelAt = maturityLevel === 1 ? 1 : maturityLevel === 2 ? 5 : null;
  const remaining = nextLevelAt ? Math.max(0, nextLevelAt - analysisCount) : 0;
  const maturityProgress = maturityLevel === 3 ? 100 : nextLevelAt ? (analysisCount / nextLevelAt) * 100 : 0;

  const stats: Stat[] = [
    { label: "コネクション", value: acceptedCount, icon: UserCheck, href: "/connections", hint: "受諾済の数", zeroHint: "出会いを増やそう" },
    { label: "未読通知", value: unreadCount ?? 0, icon: Bell, href: "/notifications", hint: "確認待ち" },
    { label: "おすすめ", value: matchCount, icon: Heart, href: "/matching", hint: "今週の候補", zeroHint: "もうすぐ準備完了" },
    { label: "メンバー", value: memberCount, icon: Users, href: "/members", hint: "全体登録数" },
  ];

  const isLoading = isLoadingConnections || isLoadingUnread || isLoadingScores;

  if (isLoading) return <DashboardSkeleton />;

  const greeting = myProfile?.name ? `こんにちは、${myProfile.name} さん` : "こんにちは";
  const isLv1 = maturityLevel === 1;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ds-eyebrow">Dashboard</p>
          <h1 className="ds-h1 mt-1 tracking-tight text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            あなたのネットワーク状況の概要
          </p>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => queryClient.invalidateQueries()}
          aria-label="データを更新"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Lv1: 最重要CTAを最上段に */}
      {isLv1 && <TldvConnectCta />}

      {/* KPI grid (B2B 質実版: アイコン box廃止 + 左 stripe + 大数値主体)
       *  - 装飾的な4色アイコンbox は外し、Card 全体を navy トーンで統一
       *  - 左に薄い4pxの brand stripe (gradient-brand) で「ブランド identity」を控えめに
       *  - 数値は ds-kpi-number = 36px tabular-nums で即読み可能 (CFO/役員向け)
       *  - アイコンは右上 muted small で副次的扱い
       *  - ChevronRight でリンクであることを示唆 (内部遷移、ArrowUpRight は外部慣習)
       *  - zeroHint は accent-strong italic で「次のアクション」を示唆
       */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const isZero = stat.value === 0;
          const display = isZero && stat.zeroHint ? stat.zeroHint : stat.hint;
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="group rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              aria-label={`${stat.label} ${stat.value.toLocaleString()}件、詳細を開く`}
            >
              <Card className="ds-card-interactive relative h-full overflow-hidden">
                <span aria-hidden="true" className="ds-card-stripe opacity-60 transition-opacity group-hover:opacity-100" />
                <CardContent className="space-y-1 pl-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground">
                      {stat.label}
                    </p>
                    <Icon
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-accent-strong"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="ds-kpi-number text-foreground">
                    {stat.value.toLocaleString()}
                  </p>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p
                      className={
                        isZero && stat.zeroHint
                          ? "text-xs italic text-accent-strong"
                          : "text-xs text-muted-foreground/80"
                      }
                    >
                      {display}
                    </p>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-accent-strong"
                      aria-hidden="true"
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* 成熟度 + プロフィール完成度 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent-strong">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-foreground">
                    おすすめ精度
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {maturityLevel === 3
                    ? "最高精度のAI分析に基づくおすすめです"
                    : `あと ${remaining} 回のミーティング分析で精度がアップします`}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  maturityLevel === 3
                    ? "border-primary/40 bg-primary/10 px-2.5 text-xs font-semibold text-primary"
                    : "border-accent/30 bg-accent/10 px-2.5 text-xs font-semibold text-accent-strong"
                }
              >
                {maturityLevel === 3 ? "Lv 3 / 3 達成" : `Lv ${maturityLevel} / 3`}
              </Badge>
            </div>
            <div className="space-y-1.5">
              <ProgressBar value={maturityProgress} ariaLabel="AI分析成熟度" />
              <div className="ds-caption-xs flex justify-between text-muted-foreground/70">
                <span>Lv 1</span>
                <span>Lv 2 (1回)</span>
                <span>Lv 3 (5回)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {myProfile && <ProfileCompleteness profile={myProfile} />}
      </div>

      {/* おすすめマッチング */}
      <SectionHeader
        eyebrow="Recommendation"
        title="おすすめの方"
        caption="プロフィール情報をもとにご紹介します"
        actionHref={(scores?.length ?? 0) > 0 ? "/matching" : undefined}
        actionLabel="すべて見る"
      />

      {scores && scores.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scores.slice(0, 3).map((score) => {
            const p = score.target_profile;
            return (
              <MemberCard
                key={score.target_id}
                onOpen={() => openProfileModal(score.target_id)}
                name={p?.name ?? "ユーザー"}
                avatarUrl={p?.avatar_url}
                role={[p?.company, p?.position].filter(Boolean).join(" / ")}
                summary={score.reasons?.[0]}
              />
            );
          })}
        </div>
      ) : isLv1 ? (
        <EmptyState
          icon={Heart}
          text="ミーティング分析を1回行うと、最適な方をご紹介できます"
          ctaHref="/settings#tldv-connect"
          ctaLabel="tl;dvを接続する"
        />
      ) : (
        <EmptyState
          icon={Heart}
          text="おすすめを準備しています..."
          ctaHref="/profile"
          ctaLabel="プロフィールを充実させる"
        />
      )}

      {/* 相互おすすめ */}
      {mutualMatches && mutualMatches.length > 0 && (
        <>
          <SectionHeader
            eyebrow="Mutual"
            title="相互におすすめ"
            caption="お互いに会うべき相手として推薦されています"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mutualMatches.slice(0, 3).map((m) => (
              <MemberCard
                key={m.user_id}
                onOpen={() => openProfileModal(m.user_id)}
                name={m.profile?.name ?? "ユーザー"}
                avatarUrl={m.profile?.avatar_url}
                role={[m.profile?.company, m.profile?.position].filter(Boolean).join(" / ")}
                summary={m.my_reasons?.[0]}
                accent
              />
            ))}
          </div>
        </>
      )}

      <NewMembersSection onViewProfile={openProfileModal} />
    </div>
  );
}

/* ───────── Subcomponents ───────── */

function ProgressBar({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-gradient-brand transition-[width] duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  caption,
  actionHref,
  actionLabel,
}: {
  eyebrow: string;
  title: string;
  caption: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="ds-eyebrow">{eyebrow}</p>
        <span className="ds-eyebrow-rule" aria-hidden="true" />
        <h2 className="ds-h2 mt-2 tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </div>
      {actionHref && actionLabel && (
        <Button variant="ghost" size="sm" render={<Link href={actionHref} />}>
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function MemberCard({
  name,
  avatarUrl,
  role,
  summary,
  onOpen,
  accent,
}: {
  name: string;
  avatarUrl?: string | null;
  role?: string;
  summary?: string | null;
  onOpen: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name} のプロフィールを開く`}
      className="group block w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-lg"
    >
      <Card
        className={`ds-card-interactive h-full ${accent ? "border-accent/25 bg-[color:color-mix(in_oklab,var(--accent)_4%,var(--card))]" : ""}`}
      >
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <UserAvatar name={name} avatarUrl={avatarUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-foreground">
                {name}
              </p>
              {role && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {role}
                </p>
              )}
            </div>
            <ArrowUpRight
              className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-accent-strong"
              aria-hidden="true"
            />
          </div>
          {summary && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {summary}
            </p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

function EmptyState({
  icon: Icon,
  text,
  ctaHref,
  ctaLabel,
}: {
  icon: LucideIcon;
  text: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
      {ctaHref && ctaLabel && (
        <Button variant="outline" size="sm" className="mt-4" render={<Link href={ctaHref} />}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-7 w-56 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[112px] animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}

function NewMembersSection({ onViewProfile }: { onViewProfile: (id: string) => void }) {
  const { data } = useMembers("", { page: 1 });
  const members = (data as { members: Profile[]; meta: unknown } | undefined)?.members;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newMembers = members?.filter(
    (m) => new Date(m.created_at).getTime() > sevenDaysAgo,
  );

  if (!newMembers?.length) return null;

  return (
    <>
      <SectionHeader
        eyebrow="New"
        title="最近参加した方"
        caption="この1週間で新しく参加したメンバー"
        actionHref="/members"
        actionLabel="メンバー一覧"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {newMembers.slice(0, 6).map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => onViewProfile(member.id)}
            aria-label={`${member.name} のプロフィールを開く`}
            className="group block w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-lg"
          >
            <Card className="ds-card-interactive h-full">
              <CardContent className="space-y-2">
                <div className="flex items-start gap-3">
                  <UserAvatar name={member.name} avatarUrl={member.avatar_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-foreground">
                      {member.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {member.company}{member.position ? ` / ${member.position}` : ""}
                    </p>
                  </div>
                  <UserPlus
                    className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-accent-strong"
                    aria-hidden="true"
                  />
                </div>
                {member.industry && (
                  <Badge variant="secondary" className="h-5 px-2.5 text-xs font-medium">
                    {member.industry}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </>
  );
}
