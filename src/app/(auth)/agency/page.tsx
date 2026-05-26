"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Crown,
  Link2,
  Users,
  UserCheck,
  MousePointerClick,
  Copy,
  Check,
  Edit2,
  Plus,
  Loader2,
  ExternalLink,
  Wallet,
  TrendingUp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useAgencyMe,
  useAgencyLinks,
  useAgencyReferrals,
  type ReferralLinkRow,
} from "@/hooks/queries/use-agency";
import {
  useCreateReferralLink,
  useUpdateReferralLink,
} from "@/hooks/mutations/use-agency-mutations";
import { nextRankInfo, RANK_LABEL, type AgencyRank } from "@/lib/agency";

const RANK_BADGE_STYLE: Record<AgencyRank, string> = {
  bronze:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  silver:
    "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  gold:
    "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  platinum:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200",
  diamond:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200",
};

const REFERRAL_STATUS_STYLE: Record<string, string> = {
  signed_up: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  paying: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  churned: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  refunded: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const REFERRAL_STATUS_LABEL: Record<string, string> = {
  signed_up: "登録完了",
  paying: "課金中",
  churned: "退会",
  refunded: "返金",
};

function formatJpy(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function AgencyDashboardPage() {
  const { data: meData, isLoading: meLoading } = useAgencyMe();
  const agency = meData?.agency ?? null;
  const isApproved = agency?.status === "approved";

  const { data: linksData, isLoading: linksLoading } = useAgencyLinks({
    enabled: isApproved,
  });
  const { data: refsData, isLoading: refsLoading } = useAgencyReferrals({
    enabled: isApproved,
  });

  const rankInfo = useMemo(() => {
    if (!agency) return null;
    return nextRankInfo(agency.total_referrals);
  }, [agency]);

  const [createOpen, setCreateOpen] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const createMutation = useCreateReferralLink();

  const [editTarget, setEditTarget] = useState<ReferralLinkRow | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const updateMutation = useUpdateReferralLink();

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  if (meLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
      </div>
    );
  }

  if (!agency || (agency.status !== "approved" && agency.status !== "suspended")) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5" />
              代理店として承認されていません
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              代理店ダッシュボードは承認済みの代理店のみご利用いただけます。
              設定ページから申請してください。
            </p>
            <Button render={<Link href="/settings" />}>設定ページへ</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (agency.status === "suspended") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-orange-700 dark:text-orange-300">
              代理店資格が停止されています
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              現在、代理店資格が一時停止されています。サポートまでお問い合わせください。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function copyLink(code: string) {
    const url = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
            Agency
          </p>
          <h1 className="text-xl font-bold md:text-2xl">代理店ダッシュボード</h1>
        </div>
        <Badge
          variant="outline"
          className={`text-sm ${RANK_BADGE_STYLE[agency.current_rank]}`}
        >
          <Crown className="mr-1 h-4 w-4" aria-hidden="true" />
          {RANK_LABEL[agency.current_rank]}
        </Badge>
      </div>

      {rankInfo?.next && (
        <Card>
          <CardContent className="py-4 text-sm">
            <p>
              次のランク <strong>{RANK_LABEL[rankInfo.next]}</strong> まで、あと
              <strong className="mx-1">{rankInfo.remaining}</strong>人の紹介が必要です。
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <StatCard
          icon={<MousePointerClick className="h-4 w-4" />}
          label="累計クリック"
          value={agency.total_clicks.toLocaleString("ja-JP")}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="累計紹介"
          value={`${agency.total_referrals.toLocaleString("ja-JP")} 人`}
        />
        <StatCard
          icon={<UserCheck className="h-4 w-4" />}
          label="累計アクティブ"
          value={`${(agency.active_referral_count ?? 0).toLocaleString("ja-JP")} 人`}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="累計獲得"
          value={formatJpy(agency.total_earnings_jpy)}
        />
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="未払い残高"
          value={formatJpy(agency.current_balance_jpy)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-5 w-5" />
            紹介リンク
          </CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新規発行
          </Button>
        </CardHeader>
        <CardContent>
          {linksLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
            </div>
          ) : (linksData?.links ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              リンクがまだありません。「新規発行」から作成してください。
            </p>
          ) : (
            <ul className="space-y-2">
              {(linksData?.links ?? []).map((link) => {
                const url = `${typeof window !== "undefined" ? window.location.origin : ""}/r/${link.code}`;
                return (
                  <li
                    key={link.id}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 md:flex-row md:items-center md:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                          {link.code}
                        </code>
                        {link.label && (
                          <span className="truncate text-sm">{link.label}</span>
                        )}
                        {!link.is_active && (
                          <Badge variant="outline" className="text-[10px]">
                            無効
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{url}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        <MousePointerClick className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                        {link.click_count}
                      </span>
                      <span>
                        <Users className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                        {link.referral_count}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyLink(link.code)}
                        aria-label={`${link.code} の URL をコピー`}
                      >
                        {copiedCode === link.code ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditTarget(link);
                          setEditLabel(link.label ?? "");
                        }}
                        aria-label={`${link.code} を編集`}
                      >
                        <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-pressed={link.is_active}
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: link.id,
                            is_active: !link.is_active,
                          })
                        }
                      >
                        {link.is_active ? "有効" : "無効"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${link.code} を開く`}
                        render={
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5" />
            紹介ユーザー
          </CardTitle>
        </CardHeader>
        <CardContent>
          {refsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
            </div>
          ) : (refsData?.referrals ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              紹介履歴はまだありません。
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(refsData?.referrals ?? []).slice(0, 50).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between md:gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {r.referred_user?.name ?? "(不明)"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.referred_user?.company ?? "—"} ·{" "}
                      {r.referral_link
                        ? `via ${r.referral_link.label ?? r.referral_link.code}`
                        : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${REFERRAL_STATUS_STYLE[r.status] ?? ""}`}
                    >
                      {REFERRAL_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.signed_up_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しい紹介リンクを発行</DialogTitle>
            <DialogDescription>
              用途やキャンペーン名 (任意) を付けると管理しやすくなります。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="link-label">ラベル (任意)</Label>
            <Input
              id="link-label"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              maxLength={80}
              placeholder="例: メルマガ用 / 名刺記載用"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              キャンセル
            </Button>
            <Button
              disabled={createMutation.isPending}
              aria-busy={createMutation.isPending}
              onClick={async () => {
                await createMutation.mutateAsync({
                  label: labelInput.trim() || undefined,
                });
                setCreateOpen(false);
                setLabelInput("");
              }}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  発行中
                </>
              ) : (
                "発行する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ラベルを編集</DialogTitle>
            <DialogDescription>
              {editTarget?.code}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="edit-link-label">ラベル</Label>
            <Input
              id="edit-link-label"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              maxLength={80}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              キャンセル
            </Button>
            <Button
              disabled={updateMutation.isPending}
              aria-busy={updateMutation.isPending}
              onClick={async () => {
                if (!editTarget) return;
                await updateMutation.mutateAsync({
                  id: editTarget.id,
                  label: editLabel.trim() || null,
                });
                setEditTarget(null);
              }}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  保存中
                </>
              ) : (
                "保存"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-3">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="text-lg font-bold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
