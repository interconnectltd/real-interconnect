"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSupabase } from "@/providers/supabase-provider";
import { useConnections } from "@/hooks/queries/use-connections";
import { ConnectedActions } from "@/components/shared/connected-actions";
import { useUnreadCount } from "@/hooks/queries/use-notifications";
import { useMatchingScores, useMutualMatches } from "@/hooks/queries/use-matching-scores";
import { useMembers } from "@/hooks/queries/use-members";
import { useUIStore } from "@/stores/ui-store";
import { useAnalysisCount } from "@/hooks/queries/use-ai-profile";
import { TldvConnectCta } from "@/components/shared/tldv-connect-cta";
import { ImportRequestCTA } from "@/components/features/import-request/import-request-cta";
import { ProfileCompleteness } from "@/components/shared/profile-completeness";
import { DashboardTour } from "@/components/onboarding/dashboard-tour";
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
      .catch((err) => {
        // 旧実装は catch 握り潰しで障害を完全に吸収していた。observability のため
        // 最低限 console.error に残し、Sentry 導入後は捕捉対象に。
        console.error("[dashboard] matching/compute-v2 failed", err);
      });
  }, [user, queryClient]);

  const acceptedCount = connections?.filter(
    (c: { status: string }) => c.status === "accepted",
  ).length ?? 0;

  // peer user_id → connection.id (accepted のみ) で MemberCard に渡す
  const connectionIdByPeerId = useMemo(() => {
    const m = new Map<string, string>();
    if (!myProfile?.id || !Array.isArray(connections)) return m;
    for (const c of connections as Array<{
      id: string;
      user_id: string;
      connected_user_id: string;
      status: string;
    }>) {
      if (c.status !== "accepted" && c.status !== "reaccepted") continue;
      const peerId =
        c.user_id === myProfile.id ? c.connected_user_id : c.user_id;
      if (peerId) m.set(peerId, c.id);
    }
    return m;
  }, [connections, myProfile?.id]);
  const memberCount =
    (membersData as { members: unknown[]; meta: { totalCount: number } } | undefined)
      ?.meta?.totalCount ?? 0;
  const matchCount = scores?.length ?? 0;

  const { data: analysisCount = 0 } = useAnalysisCount();
  const maturityLevel = analysisCount === 0 ? 1 : analysisCount <= 4 ? 2 : 3;
  const nextLevelAt = maturityLevel === 1 ? 1 : maturityLevel === 2 ? 5 : null;
  const remaining = nextLevelAt ? Math.max(0, nextLevelAt - analysisCount) : 0;
  const maturityProgress = maturityLevel === 3 ? 100 : nextLevelAt ? (analysisCount / nextLevelAt) * 100 : 0;

  // useMemo で stats 配列を安定化 → KPI Link の参照同一性を保ち
  // refetch 時の不必要な再 render を抑止
  const stats = useMemo<Stat[]>(
    () => [
      { label: "コネクション", value: acceptedCount, icon: UserCheck, href: "/connections", hint: "受諾済の数", zeroHint: "出会いを増やそう" },
      { label: "未読通知", value: unreadCount ?? 0, icon: Bell, href: "/notifications", hint: "確認待ち" },
      { label: "おすすめ", value: matchCount, icon: Heart, href: "/matching", hint: "今週の候補", zeroHint: "もうすぐ準備完了" },
      { label: "メンバー", value: memberCount, icon: Users, href: "/members", hint: "全体登録数" },
    ],
    [acceptedCount, unreadCount, matchCount, memberCount],
  );

  const isLoading = isLoadingConnections || isLoadingUnread || isLoadingScores;

  if (isLoading) return <DashboardSkeleton />;

  const greeting = myProfile?.name ? `こんにちは、${myProfile.name} さん` : "こんにちは";
  const isLv1 = maturityLevel === 1;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Hero — 右半分にイラストを背景レイヤーとして大きく配置、
          左→右の background gradient mask で text を保護。Bento 風 */}
      <section className="relative isolate overflow-hidden">
        {/* 背景イラスト (md 以上で表示、SP は省略) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden md:block md:w-3/5 lg:w-1/2"
        >
          <Image
            src="/illustrations/spot-dashboard-hero.png"
            alt=""
            fill
            sizes="(max-width: 1024px) 60vw, 600px"
            className="object-cover object-center opacity-90"
            priority
          />
          {/* 左→右の background fade で text 領域を保護 */}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent md:via-background/70" />
        </div>

        <div className="relative flex items-start justify-between gap-3 py-2 md:min-h-[160px]">
          <div className="min-w-0 flex-1">
            <p className="ds-eyebrow">Dashboard</p>
            <h1 className="ds-h1 mt-1 tracking-tight text-foreground">{greeting}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              あなたのネットワーク状況の概要
            </p>
          </div>
          <Button
            variant="outline"
            size="icon-lg"
            onClick={() => {
              // 全 query 無差別 invalidate は N+1 と rate limit を誘発するため、
              // ダッシュボード関連の代表 queryKey に絞る (refetchType: active)
              queryClient.invalidateQueries({
                predicate: (q) => {
                  const k = q.queryKey[0];
                  return (
                    k === "connections" ||
                    k === "notifications" ||
                    k === "matching" ||
                    k === "members" ||
                    k === "ai-profile"
                  );
                },
                refetchType: "active",
              });
            }}
            aria-label="データを更新"
        >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Lv1: 最重要CTAを最上段に */}
      {isLv1 && (
        <div data-tour="tldv-cta">
          <TldvConnectCta />
        </div>
      )}

      {/* tl:dv 接続済でも会議データが取り込まれていない場合の運営申請 CTA */}
      {analysisCount === 0 && (
        <ImportRequestCTA />
      )}

      {/* KPI Overview — Linear/Stripe Dashboard 系の "罫線区切り inline grid"
       *
       * Card 廃止理由:
       *   各 KPI を個別 Card で囲うと shadow + radius + border + stripe の
       *   繰り返しで「AI 生成 SaaS テンプレ」感が出る。
       *   Linear / Stripe / Mercury のダッシュボードは KPI を一枚の
       *   オーバービュー行にまとめ、内部を罫線で区切る。
       */}
      <section
        data-tour="kpi-overview"
        aria-label="ネットワーク指標"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          {stats.map((stat) => {
            const isZero = stat.value === 0;
            const display = isZero && stat.zeroHint ? stat.zeroHint : stat.hint;
            return (
              <Link
                key={stat.label}
                href={stat.href}
                aria-label={`${stat.label} ${stat.value.toLocaleString()}件、詳細を開く`}
                className="group block px-6 py-5 outline-none transition-colors hover:bg-muted/40 focus-visible:relative focus-visible:z-10 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/70"
              >
                <p className="ds-kpi-label">
                  {stat.label}
                </p>
                <p className="ds-kpi-number mt-2 text-foreground">
                  {stat.value.toLocaleString()}
                </p>
                <p
                  className={
                    isZero && stat.zeroHint
                      ? "mt-1.5 text-xs text-accent-strong"
                      : "mt-1.5 text-xs text-muted-foreground"
                  }
                >
                  {display}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 成熟度 + プロフィール完成度 — shadow / stripe を抑え border-only に */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-tour="maturity-card">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="ds-kpi-label">
                おすすめ精度
              </p>
              <Sparkles
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                aria-hidden="true"
              />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="ds-kpi-number-md text-foreground">Lv {maturityLevel}</span>
              <span className="text-sm text-muted-foreground">/ 3</span>
              {maturityLevel === 3 && (
                <Badge
                  variant="outline"
                  className="ml-1 border-primary/40 bg-primary/10 px-2 text-xs font-semibold text-primary"
                >
                  達成
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {maturityLevel === 3
                ? "最高精度のAI分析に基づくおすすめです"
                : `あと ${remaining} 回のミーティング分析で精度がアップします`}
            </p>
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
      <div data-tour="recommendation-section" className="space-y-4">
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
                userId={score.target_id}
                connectionId={connectionIdByPeerId.get(score.target_id)}
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
          illustration={{
            src: "/illustrations/empty-dashboard.png",
            alt: "ミーティング分析を始めると、ここにおすすめが表示されます",
            width: 480,
            height: 280,
          }}
        />
      ) : (
        <EmptyState
          icon={Heart}
          text="おすすめを準備しています..."
          ctaHref="/profile"
          ctaLabel="プロフィールを充実させる"
          illustration={{
            src: "/illustrations/empty-dashboard.png",
            alt: "おすすめを準備中",
            width: 480,
            height: 280,
          }}
        />
      )}
      </div>

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
                userId={m.user_id}
                connectionId={connectionIdByPeerId.get(m.user_id)}
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

      <NewMembersSection
        members={
          (membersData as { members?: Profile[] } | undefined)?.members
        }
        onViewProfile={openProfileModal}
      />

      {/* 初回ログインの案内 + 右下 ? ヘルプ FAB (auth全画面に表示するため別途 layout で出すこともできるが、Dashboard 専用 tour なのでこの位置で配置) */}
      <DashboardTour isLv1={isLv1} />
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
  userId,
  name,
  avatarUrl,
  role,
  summary,
  onOpen,
  accent,
  connectionId,
}: {
  userId?: string;
  name: string;
  avatarUrl?: string | null;
  role?: string;
  summary?: string | null;
  onOpen: () => void;
  accent?: boolean;
  /** accepted の場合のみ ConnectedActions を出す */
  connectionId?: string;
}) {
  // button-in-button を避けるため div role="button" 化
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
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
      aria-label={`${name} のプロフィールを開く`}
      className="group block w-full cursor-pointer text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-lg"
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
          {connectionId && userId && (
            <div className="pt-1">
              <ConnectedActions
                connectionId={connectionId}
                targetUserId={userId}
                variant="card"
                onOpenProfile={onOpen}
                onRequestMeeting={onOpen}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  text,
  ctaHref,
  ctaLabel,
  illustration,
}: {
  icon: LucideIcon;
  text: string;
  ctaHref?: string;
  ctaLabel?: string;
  /** 与えられたら Icon の代わりに画像を表示 (W/H は intrinsic、表示は className で制御) */
  illustration?: { src: string; alt: string; width: number; height: number };
}) {
  return (
    <div className="ds-empty-state">
      {illustration ? (
        <Image
          src={illustration.src}
          alt={illustration.alt}
          width={illustration.width}
          height={illustration.height}
          className="mx-auto h-auto w-full max-w-[420px]"
          priority={false}
        />
      ) : (
        <Icon className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      )}
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

// 親で取得済みの members 配列を props で受け取る (重複 useMembers 削除)
function NewMembersSection({
  members,
  onViewProfile,
}: {
  members: Profile[] | undefined;
  onViewProfile: (id: string) => void;
}) {
  // useState lazy initializer で mount 時 1 度だけ Date.now() 評価
  // React 19 rules-of-react: render 中の impure function call を回避
  const [mountedAt] = useState(() => Date.now());
  const newMembers = useMemo(() => {
    if (!members?.length) return null;
    const sevenDaysAgo = mountedAt - 7 * 24 * 60 * 60 * 1000;
    return members.filter((m) => new Date(m.created_at).getTime() > sevenDaysAgo);
  }, [members, mountedAt]);

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
