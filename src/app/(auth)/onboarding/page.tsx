"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Handshake, MessageCircle, TrendingUp, Users, RefreshCw, GraduationCap,
  ChevronRight, ChevronLeft, Check, Briefcase, Globe2, Wallet, Sprout,
  UserPlus, Wrench, Megaphone, Scale, ShoppingBag, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useSupabase } from "@/providers/supabase-provider";
import { GOAL_TYPES, GOAL_GROUPS, type GoalGroup } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const GOAL_ICONS: Record<string, React.ElementType> = {
  client_intro:    UserPlus,
  partnership:     Handshake,
  sales_support:   ShoppingBag,
  m_and_a:         Briefcase,
  international:   Globe2,
  investment_seek: Sprout,
  investment_offer: TrendingUp,
  subsidy:         Wallet,
  recruitment:     Users,
  outsourcing_seek: Wrench,
  dx_systemize:    RefreshCw,
  marketing_pr:    Megaphone,
  consulting:      MessageCircle,
  mentoring:       GraduationCap,
  expertise_pro:   Scale,
};

// ── Step Indicator ──

function StepIndicator({
  current,
  subProgress,
}: {
  current: number;
  /** Step1 内の進捗 (goals/offerings 各≥1で 100%) */
  subProgress?: { goalsCount: number; offeringsCount: number };
}) {
  const steps = ["基本情報の確認", "目的と提供", "完了"];
  return (
    <ol
      className="mb-8 flex items-center justify-center gap-2"
      aria-label="オンボーディング進行状況"
    >
      {steps.map((label, i) => (
        <li
          key={label}
          className="flex items-center gap-2"
          aria-current={i === current ? "step" : undefined}
        >
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium",
              i < current
                ? "bg-primary text-primary-foreground"
                : i === current
                  ? "border-2 border-primary text-primary"
                  : "border border-muted-foreground/30 text-muted-foreground/50",
            )}
            aria-hidden="true"
          >
            {i < current ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </div>
          <span
            className={cn(
              "hidden text-xs sm:inline",
              i === current ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {i === 1 && i === current && subProgress
              ? `目的${subProgress.goalsCount} / 提供${subProgress.offeringsCount}`
              : label}
          </span>
          {i < steps.length - 1 && (
            <div className="mx-1 h-px w-6 bg-border sm:w-10" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

// ── Group Section (タクソノミ4分類のサブヘッダ + そのカテゴリ群) ──

type GoalItem = (typeof GOAL_TYPES)[number];

function GroupSection({
  group,
  items,
  getDescription,
  isSelected,
  onToggle,
  detailValue,
  onDetailChange,
}: {
  group: { value: GoalGroup; label: string };
  items: readonly GoalItem[];
  getDescription: (item: GoalItem) => string;
  isSelected: (type: string) => boolean;
  onToggle: (type: string) => void;
  detailValue?: (type: string) => string;
  onDetailChange?: (type: string, value: string) => void;
}) {
  // description が "" の項目は seek/offer 片側にしか意味が無いカテゴリ (投資家/起業家)。
  // UI 上は反対側を非表示にして混乱を防ぐ。
  const visibleItems = items.filter((g) => getDescription(g).trim().length > 0);
  if (visibleItems.length === 0) return null;
  const headingId = `group-heading-${group.value}`;
  return (
    <section
      role="group"
      aria-labelledby={headingId}
      className="mb-4"
    >
      <h3
        id={headingId}
        className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {group.label}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {visibleItems.map((g) => (
          <SelectableCard
            key={g.value}
            type={g.value}
            label={g.label}
            description={getDescription(g)}
            selected={isSelected(g.value)}
            onToggle={() => onToggle(g.value)}
            detailValue={detailValue?.(g.value) ?? ""}
            onDetailChange={
              onDetailChange ? (v) => onDetailChange(g.value, v) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

// ── Goal/Offering Card ──

function SelectableCard({
  type,
  label,
  description,
  selected,
  onToggle,
  detailValue = "",
  onDetailChange,
}: {
  type: string;
  label: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
  detailValue?: string;
  onDetailChange?: (value: string) => void;
}) {
  const Icon = GOAL_ICONS[type] ?? RefreshCw;
  const detailId = `card-detail-${type}`;
  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/30 hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", selected && "text-primary")}>
            {label}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {selected && (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
      </button>

      {/* 選択中のみ inline 詳細 textarea (任意, AI抽出時の補助情報) */}
      {selected && onDetailChange && (
        <div className="border-t border-primary/10 px-4 pb-3 pt-2">
          <div className="mb-1 flex items-center justify-between">
            <Label
              htmlFor={detailId}
              className="text-xs font-medium text-muted-foreground"
            >
              詳細・条件 (任意・マッチング精度向上)
            </Label>
            <span
              className={cn(
                "text-xs tabular-nums",
                detailValue.length > 450
                  ? "text-destructive"
                  : "text-muted-foreground/60",
              )}
            >
              {detailValue.length} / 500
            </span>
          </div>
          <textarea
            id={detailId}
            value={detailValue}
            onChange={(e) => onDetailChange(e.target.value)}
            placeholder="例: AI関連スタートアップ、500万-3000万、東京都内"
            rows={2}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            maxLength={500}
          />
        </div>
      )}
    </div>
  );
}

// ── Main ──

export default function OnboardingPage() {
  const { supabase, user } = useSupabase();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  // Step 1: 基本情報
  // user_profiles を source of truth として読む (user_metadata は frozen snapshot)。
  // 連絡先 (contact_info) は当アプリでは収集しない方針 — マッチング承諾後の連絡は
  // アプリ内チャット + Google Meet 自動発行で完結させる (PII 非保持・越境移転回避)。
  const [profile, setProfile] = useState({
    name: user?.user_metadata?.name ?? "",
    company: user?.user_metadata?.company ?? "",
    position: user?.user_metadata?.position ?? "",
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraftSnapshot, setBasicDraftSnapshot] = useState<{
    name: string;
    company: string;
    position: string;
  } | null>(null);

  useEffect(() => {
    if (!user?.id || profileLoaded) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("name, company, position")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setProfile({
          name: (data as { name?: string }).name ?? user?.user_metadata?.name ?? "",
          company:
            (data as { company?: string | null }).company ??
            user?.user_metadata?.company ??
            "",
          position:
            (data as { position?: string | null }).position ??
            user?.user_metadata?.position ??
            "",
        });
      }
      setProfileLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // user.id 変化のみ依存。user_metadata は object reference で再 render 毎に変化するので除外
  }, [user?.id, profileLoaded, supabase]);

  // Step 2: Goals & Offerings + 各カテゴリの詳細(任意 free-text)
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set());
  const [selectedOfferings, setSelectedOfferings] = useState<Set<string>>(new Set());
  const [goalDetails, setGoalDetails] = useState<Record<string, string>>({});
  const [offeringDetails, setOfferingDetails] = useState<Record<string, string>>({});
  // Goals/Offerings タブ切替 (mobile縦スクロール削減)
  const [step2Tab, setStep2Tab] = useState<"goals" | "offerings">("goals");
  const goalsTabRef = useRef<HTMLButtonElement | null>(null);
  const offeringsTabRef = useRef<HTMLButtonElement | null>(null);

  // localStorage hydrate/persist (入力消失防止 / 誤リロード対策)
  // user.id 別 key で他人と混在しない、handleComplete 成功時に削除。
  // Set はシリアライズ不能なので Array で往復させる。
  const draftKey = user?.id ? `interconnect:onboarding-draft:${user.id}:v1` : null;
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!draftKey || hydratedRef.current) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          goals?: string[];
          offerings?: string[];
          goalDetails?: Record<string, string>;
          offeringDetails?: Record<string, string>;
        };
        if (Array.isArray(draft.goals)) setSelectedGoals(new Set(draft.goals));
        if (Array.isArray(draft.offerings))
          setSelectedOfferings(new Set(draft.offerings));
        if (draft.goalDetails) setGoalDetails(draft.goalDetails);
        if (draft.offeringDetails) setOfferingDetails(draft.offeringDetails);
      }
    } catch {
      // 破損 JSON は無視 (次回保存で上書き)
    }
    hydratedRef.current = true;
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !hydratedRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            goals: [...selectedGoals],
            offerings: [...selectedOfferings],
            goalDetails,
            offeringDetails,
          }),
        );
      } catch {
        // QuotaExceeded 等は無視
      }
    }, 400);
    return () => clearTimeout(t);
  }, [draftKey, selectedGoals, selectedOfferings, goalDetails, offeringDetails]);

  function toggleGoal(type: string) {
    setSelectedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function toggleOffering(type: string) {
    setSelectedOfferings((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // GOAL_TYPES の label を value で引く Map (毎 render の find を回避)
  const goalLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of GOAL_TYPES) m.set(g.value, g.label);
    return m;
  }, []);

  // 重複選択 (goals ∩ offerings) のラベル一覧
  const overlapLabels = useMemo(() => {
    const labels: string[] = [];
    for (const t of selectedGoals) {
      if (selectedOfferings.has(t)) {
        const l = goalLabelMap.get(t);
        if (l) labels.push(l);
      }
    }
    return labels;
  }, [selectedGoals, selectedOfferings, goalLabelMap]);

  async function handleComplete() {
    setSaving(true);
    try {
      // 入力 sanitize: 制御文字 + BiDi override を削除 (admin UI / log 表示崩し防止 / Wave3 sec audit)
      const stripCtrl = (s: string) =>
        s.replace(/[\x00-\x1f\x7f‪-‮⁦-⁩]/g, "").slice(0, 500);
      const stripField = (s: string, max: number) =>
        s
          .replace(/[\x00-\x1f\x7f‪-‮⁦-⁩]/g, "")
          .trim()
          .slice(0, max);

      // RPC は v2 シグネチャ (連絡先・第三者提供同意の引数を撤去済 / mig 00034)。
      // 単一トランザクションで profile + goals/offerings + onboarding_step を更新し、
      // partial failure による「永久ロック」状態を防ぐ。
      type RpcLoose = {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
      const { error: rpcError } = await (
        supabase as unknown as RpcLoose
      ).rpc("complete_onboarding", {
        p_user_id: user!.id,
        p_name: stripField(profile.name, 100),
        p_company: stripField(profile.company, 200),
        p_position: stripField(profile.position, 100),
        p_goals: [...selectedGoals].map((type) => ({
          type,
          detail: stripCtrl(goalDetails[type] ?? ""),
        })),
        p_offerings: [...selectedOfferings].map((type) => ({
          type,
          detail: stripCtrl(offeringDetails[type] ?? ""),
        })),
      });
      if (rpcError) throw new Error(rpcError.message ?? "RPC failed");

      // 保存成功 → localStorage draft を破棄 (再 onboarding 時の誤復元防止)
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* noop */
        }
      }

      router.replace("/dashboard?onboarding_complete=true");
      router.refresh();
    } catch (e) {
      console.error("Onboarding error:", e);
      toast.error("保存に失敗しました。もう一度お試しください。");
      setSaving(false);
    }
  }

  return (
    <div>
      <StepIndicator
        current={step}
        subProgress={
          step === 1
            ? { goalsCount: selectedGoals.size, offeringsCount: selectedOfferings.size }
            : undefined
        }
      />

      {/* Step 0: 基本情報確認 */}
      {step === 0 && (
        <div className="space-y-6">
          <Image
            src="/illustrations/onboarding-step-0.png"
            alt=""
            width={240}
            height={180}
            className="mx-auto h-auto w-full max-w-[200px]"
            aria-hidden="true"
            priority
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold">基本情報の確認</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              約2分で完了します
            </p>
          </div>

          {/* 登録時に入力済情報の確認カード (default read-only) */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    登録時の情報
                  </p>
                  <p className="mt-2 text-base font-semibold text-foreground">
                    {profile.name || <span className="text-muted-foreground">(お名前 未入力)</span>}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {profile.company || "(会社名 未入力)"}
                    {profile.position && ` / ${profile.position}`}
                  </p>
                </div>
                {!editingBasic && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBasicDraftSnapshot({
                        name: profile.name,
                        company: profile.company,
                        position: profile.position,
                      });
                      setEditingBasic(true);
                    }}
                    className="shrink-0"
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" /> 修正
                  </Button>
                )}
              </div>

              {editingBasic && (
                <div className="mt-4 space-y-3 rounded-md border border-border/60 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-name">
                      お名前 <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Input
                      id="ob-name"
                      autoComplete="name"
                      enterKeyHint="next"
                      required
                      aria-required="true"
                      aria-invalid={!profile.name.trim()}
                      value={profile.name}
                      onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ob-company">会社名</Label>
                      <Input
                        id="ob-company"
                        autoComplete="organization"
                        enterKeyHint="next"
                        value={profile.company}
                        onChange={(e) =>
                          setProfile({ ...profile, company: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ob-position">役職</Label>
                      <Input
                        id="ob-position"
                        autoComplete="organization-title"
                        enterKeyHint="next"
                        value={profile.position}
                        onChange={(e) =>
                          setProfile({ ...profile, position: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // キャンセル: snapshot 復元
                        if (basicDraftSnapshot) {
                          setProfile((prev) => ({
                            ...prev,
                            name: basicDraftSnapshot.name,
                            company: basicDraftSnapshot.company,
                            position: basicDraftSnapshot.position,
                          }));
                        }
                        setBasicDraftSnapshot(null);
                        setEditingBasic(false);
                      }}
                    >
                      キャンセル
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        // 保存(=変更を保持して閉じる)。 DB反映は完了画面の handleComplete で行う
                        setBasicDraftSnapshot(null);
                        setEditingBasic(false);
                      }}
                    >
                      変更を保持
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 連絡先・第三者提供同意は撤去 (2026-05-06)。
              マッチング承諾後の連絡はアプリ内チャット + Google Meet 自動発行で完結。
              個人情報の収集・第三者提供を発生させないことでプライバシーリスクと
              越境移転コストを最小化。 */}
          <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            マッチング後のやり取りはすべて<strong className="font-semibold text-foreground">アプリ内チャット</strong>で完結します。
            日程調整は同チャット内のカードから Google Meet を自動発行できるため、
            メールアドレスや電話番号などの<strong className="font-semibold text-foreground">連絡先を交換する必要はありません</strong>。
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => setStep(1)}
              disabled={saving || !profileLoaded || !profile.name.trim()}
              aria-describedby="step0-next-help"
            >
              次へ <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          {!profileLoaded && (
            <p id="step0-next-help" className="text-right text-xs text-muted-foreground">
              プロフィール読み込み中...
            </p>
          )}
          {profileLoaded && !profile.name.trim() && (
            <p id="step0-next-help" className="text-right text-xs text-destructive">
              お名前の入力が必要です
            </p>
          )}
        </div>
      )}

      {/* Step 1: Goals & Offerings (16カテゴリ4グループ + タブ切替) */}
      {step === 1 && (
        <div className="space-y-6">
          <Image
            src="/illustrations/onboarding-step-1.png"
            alt=""
            width={240}
            height={180}
            className="mx-auto h-auto w-full max-w-[200px]"
            aria-hidden="true"
            priority
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold">あなたの目的と提供できること</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              求めていること・提供できることをそれぞれ複数選択。詳細を書き込むほどマッチング精度が向上します。
            </p>
          </div>

          {/* Goals/Offerings タブ切替 (mobile縦スクロール削減 + WAI-ARIA tablist) */}
          <div
            role="tablist"
            aria-label="目的と提供できることの選択"
            className="flex items-center gap-2 border-b"
            onKeyDown={(e) => {
              // IME 変換中の矢印キーはタブ切替に流用しない (日本語入力中の暴発防止)
              if (e.nativeEvent.isComposing) return;
              let next: "goals" | "offerings" | null = null;
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                next = step2Tab === "goals" ? "offerings" : "goals";
              } else if (e.key === "Home") {
                next = "goals";
              } else if (e.key === "End") {
                next = "offerings";
              }
              if (next) {
                e.preventDefault();
                setStep2Tab(next);
                // フォーカスを新タブの button に移動 (roving tabIndex 標準動作)
                const target = next;
                requestAnimationFrame(() => {
                  const ref =
                    target === "goals" ? goalsTabRef.current : offeringsTabRef.current;
                  ref?.focus();
                });
              }
            }}
          >
            <button
              type="button"
              id="tab-goals"
              ref={goalsTabRef}
              role="tab"
              aria-selected={step2Tab === "goals"}
              aria-controls="panel-goals"
              tabIndex={step2Tab === "goals" ? 0 : -1}
              onClick={() => setStep2Tab("goals")}
              className={cn(
                "relative px-4 pb-2 text-sm font-medium transition-colors",
                step2Tab === "goals"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              求めていること{" "}
              <Badge
                variant={selectedGoals.size === 0 ? "destructive" : "secondary"}
                className="ml-1 text-xs"
                aria-label={
                  selectedGoals.size === 0
                    ? "求めていることが未選択です"
                    : `求めていること ${selectedGoals.size} 件選択中`
                }
              >
                {selectedGoals.size}
              </Badge>
              {step2Tab === "goals" && (
                <span aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              type="button"
              id="tab-offerings"
              ref={offeringsTabRef}
              role="tab"
              aria-selected={step2Tab === "offerings"}
              aria-controls="panel-offerings"
              tabIndex={step2Tab === "offerings" ? 0 : -1}
              onClick={() => setStep2Tab("offerings")}
              className={cn(
                "relative px-4 pb-2 text-sm font-medium transition-colors",
                step2Tab === "offerings"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              提供できること{" "}
              <Badge
                variant={
                  selectedOfferings.size === 0 ? "destructive" : "secondary"
                }
                className="ml-1 text-xs"
                aria-label={
                  selectedOfferings.size === 0
                    ? "提供できることが未選択です"
                    : `提供できること ${selectedOfferings.size} 件選択中`
                }
              >
                {selectedOfferings.size}
              </Badge>
              {step2Tab === "offerings" && (
                <span aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>

          {/* aria-live で 0件→選択済みの差分を通知 (両方未選択時も読み上げる) */}
          <p
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {selectedGoals.size === 0 && selectedOfferings.size === 0
              ? "求めていること・提供できることがどちらも未選択です"
              : selectedGoals.size === 0
                ? "求めていることが未選択です"
                : selectedOfferings.size === 0
                  ? "提供できることが未選択です"
                  : ""}
          </p>

          {/* 重複選択の検出ヒント (label 検索を Map で O(1) 化) */}
          {overlapLabels.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              両方に選択中: {overlapLabels.join("、")} ({overlapLabels.length}個)。
              同じカテゴリを両方に入れる場合は、それぞれの<strong>詳細</strong>欄で違いを書くとマッチング精度が上がります。
            </p>
          )}

          {/* Goals タブ */}
          {step2Tab === "goals" && (
            <div
              role="tabpanel"
              id="panel-goals"
              aria-labelledby="tab-goals"
            >
              {selectedGoals.size === 0 && (
                <p role="alert" className="mb-2 text-xs text-destructive">最低1つ選択してください</p>
              )}
              {GOAL_GROUPS.map((grp) => (
                <GroupSection
                  key={`goal-${grp.value}`}
                  group={grp}
                  items={GOAL_TYPES.filter((g) => g.group === grp.value)}
                  getDescription={(g) => g.seekDescription}
                  isSelected={(t) => selectedGoals.has(t)}
                  onToggle={(t) => toggleGoal(t)}
                  detailValue={(t) => goalDetails[t] ?? ""}
                  onDetailChange={(t, v) =>
                    setGoalDetails((prev) => ({ ...prev, [t]: v }))
                  }
                />
              ))}
            </div>
          )}

          {/* Offerings タブ */}
          {step2Tab === "offerings" && (
            <div
              role="tabpanel"
              id="panel-offerings"
              aria-labelledby="tab-offerings"
            >
              {selectedOfferings.size === 0 && (
                <p role="alert" className="mb-2 text-xs text-destructive">最低1つ選択してください</p>
              )}
              {GOAL_GROUPS.map((grp) => (
                <GroupSection
                  key={`offer-${grp.value}`}
                  group={grp}
                  items={GOAL_TYPES.filter((g) => g.group === grp.value)}
                  getDescription={(g) => g.offerDescription}
                  isSelected={(t) => selectedOfferings.has(t)}
                  onToggle={(t) => toggleOffering(t)}
                  detailValue={(t) => offeringDetails[t] ?? ""}
                  onDetailChange={(t, v) =>
                    setOfferingDetails((prev) => ({ ...prev, [t]: v }))
                  }
                />
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> 戻る
            </Button>
            <Button
              onClick={() => setStep(2)}
              disabled={selectedGoals.size + selectedOfferings.size === 0}
              aria-describedby={
                selectedGoals.size + selectedOfferings.size === 0
                  ? "step1-next-help"
                  : undefined
              }
            >
              次へ <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          {selectedGoals.size + selectedOfferings.size === 0 && (
            <p
              id="step1-next-help"
              className="text-right text-xs text-destructive"
            >
              「求めていること」または「提供できること」を 1 件以上選択してください
            </p>
          )}
        </div>
      )}

      {/* Step 2: 完了 */}
      {step === 2 && (
        <div className="space-y-6">
          <Image
            src="/illustrations/onboarding-step-2.png"
            alt=""
            width={240}
            height={180}
            className="mx-auto h-auto w-full max-w-[200px]"
            aria-hidden="true"
            priority
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold">準備完了です</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              あなたにぴったりのつながりを見つけましょう
            </p>
          </div>

          <Card>
            <CardContent className="space-y-4 p-6">
              {/* 基本情報サマリ */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">基本情報</p>
                  <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> 修正
                  </Button>
                </div>
                <p className="mt-1 text-sm">
                  <strong>{profile.name}</strong>{" "}
                  {profile.company && (
                    <span className="text-muted-foreground">
                      / {profile.company}
                      {profile.position && ` / ${profile.position}`}
                    </span>
                  )}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    求めていること ({selectedGoals.size}件)
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => { setStep(1); setStep2Tab("goals"); }}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> 修正
                  </Button>
                </div>
                <div className="mt-1 space-y-1">
                  {[...selectedGoals].map((type) => {
                    const g = GOAL_TYPES.find((gt) => gt.value === type);
                    const detail = goalDetails[type];
                    return (
                      <div key={type} className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-xs">
                          {g?.label ?? type}
                        </Badge>
                        {detail && (
                          <span className="text-xs text-muted-foreground">- {detail}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    提供できること ({selectedOfferings.size}件)
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => { setStep(1); setStep2Tab("offerings"); }}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> 修正
                  </Button>
                </div>
                <div className="mt-1 space-y-1">
                  {[...selectedOfferings].map((type) => {
                    const g = GOAL_TYPES.find((gt) => gt.value === type);
                    const detail = offeringDetails[type];
                    return (
                      <div key={type} className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-xs">
                          {g?.label ?? type}
                        </Badge>
                        {detail && (
                          <span className="text-xs text-muted-foreground">- {detail}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> 戻る
            </Button>
            <Button onClick={handleComplete} disabled={saving}>
              {saving ? "保存中..." : "この内容で始める"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
