"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Handshake, MessageCircle, TrendingUp, Users, RefreshCw, GraduationCap,
  ChevronRight, ChevronLeft, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useSupabase } from "@/providers/supabase-provider";
import { GOAL_TYPES } from "@/lib/constants";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const GOAL_ICONS: Record<string, React.ElementType> = {
  partnership: Handshake,
  consulting: MessageCircle,
  investment: TrendingUp,
  recruitment: Users,
  information: RefreshCw,
  mentoring: GraduationCap,
};

// ── Step Indicator ──

function StepIndicator({ current }: { current: number }) {
  const steps = ["基本情報の確認", "目的と提供", "完了"];
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
              i < current
                ? "bg-primary text-primary-foreground"
                : i === current
                  ? "border-2 border-primary text-primary"
                  : "border border-muted-foreground/30 text-muted-foreground/50",
            )}
          >
            {i < current ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </div>
          <span
            className={cn(
              "hidden text-xs sm:inline",
              i === current ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          {i < steps.length - 1 && (
            <div className="mx-1 h-px w-6 bg-border sm:w-10" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Goal/Offering Card ──

function SelectableCard({
  type,
  label,
  description,
  selected,
  onToggle,
}: {
  type: string;
  label: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const Icon = GOAL_ICONS[type] ?? RefreshCw;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-all",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/30 hover:bg-muted/50",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", selected && "text-primary")}>
          {label}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {selected && (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      )}
    </button>
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
  const [profile, setProfile] = useState({
    name: user?.user_metadata?.name ?? "",
    company: user?.user_metadata?.company ?? "",
    position: user?.user_metadata?.position ?? "",
    contact_info: "",
  });

  // Step 2: Goals & Offerings
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set());
  const [selectedOfferings, setSelectedOfferings] = useState<Set<string>>(new Set());

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

  async function handleComplete() {
    setSaving(true);
    try {
      // Step 1: プロフィール更新
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({
          name: profile.name,
          company: profile.company,
          position: profile.position,
          contact_info: profile.contact_info || null,
          onboarding_step: 3,
        })
        .eq("id", user!.id);
      if (updateError) throw updateError;

      // Step 2: Goals 保存
      await api.post("/goals", {
        goals: [...selectedGoals].map((type) => ({ type })),
      });

      // Step 2: Offerings 保存
      await api.post("/offerings", {
        offerings: [...selectedOfferings].map((type) => ({ type })),
      });

      // 少し待ってからリダイレクト（Supabaseの書き込み反映を待つ）
      await new Promise((r) => setTimeout(r, 500));
      window.location.href = "/dashboard?onboarding_complete=true";
    } catch (e) {
      console.error("Onboarding error:", e);
      toast.error("保存に失敗しました。もう一度お試しください。");
      setSaving(false);
    }
  }

  return (
    <div>
      <StepIndicator current={step} />

      {/* Step 0: 基本情報確認 */}
      {step === 0 && (
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold">基本情報の確認</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              約2分で完了します
            </p>
          </div>

          <Card>
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                以下の情報が正しいか確認してください。必要に応じて編集できます。
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ob-name">お名前</Label>
                  <Input
                    id="ob-name"
                    autoComplete="name"
                    enterKeyHint="next"
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
                      onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-position">役職</Label>
                    <Input
                      id="ob-position"
                      autoComplete="organization-title"
                      enterKeyHint="next"
                      value={profile.position}
                      onChange={(e) => setProfile({ ...profile, position: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-contact">連絡先（マッチング後に相手に表示されます）</Label>
                  <Input
                    id="ob-contact"
                    autoComplete="off"
                    enterKeyHint="done"
                    placeholder="例: LINE ID、電話番号、メールアドレスなど"
                    value={profile.contact_info}
                    onChange={(e) => setProfile({ ...profile, contact_info: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    未登録の場合、アカウントのメールアドレスが自動的に表示されます
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={saving || !profile.name.trim()}>
              次へ <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Goals & Offerings */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold">あなたの目的と提供できること</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              それぞれ最低1つ選んでください。マッチングの精度に直結します。
            </p>
          </div>

          {/* Goals */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold">求めていること</h2>
              <Badge variant="secondary" className="text-xs">
                {selectedGoals.size}個選択
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {GOAL_TYPES.map((g) => (
                <SelectableCard
                  key={g.value}
                  type={g.value}
                  label={g.label}
                  description={g.description}
                  selected={selectedGoals.has(g.value)}
                  onToggle={() => toggleGoal(g.value)}
                />
              ))}
            </div>
          </div>

          {/* Offerings */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold">提供できること</h2>
              <Badge variant="secondary" className="text-xs">
                {selectedOfferings.size}個選択
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {GOAL_TYPES.map((g) => (
                <SelectableCard
                  key={g.value}
                  type={g.value}
                  label={g.label}
                  description={g.description}
                  selected={selectedOfferings.has(g.value)}
                  onToggle={() => toggleOffering(g.value)}
                />
              ))}
            </div>
          </div>

          {/* Validation hint */}
          {(selectedGoals.size === 0 || selectedOfferings.size === 0) && (
            <p className="text-center text-xs text-muted-foreground">
              それぞれ最低1つ選択してください
            </p>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> 戻る
            </Button>
            <Button
              onClick={() => setStep(2)}
              disabled={selectedGoals.size === 0 || selectedOfferings.size === 0}
            >
              次へ <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: 完了 */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold">準備完了です</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              あなたにぴったりのつながりを見つけましょう
            </p>
          </div>

          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground">求めていること</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[...selectedGoals].map((type) => {
                    const g = GOAL_TYPES.find((gt) => gt.value === type);
                    return (
                      <Badge key={type} variant="secondary" className="text-xs">
                        {g?.label ?? type}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">提供できること</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[...selectedOfferings].map((type) => {
                    const g = GOAL_TYPES.find((gt) => gt.value === type);
                    return (
                      <Badge key={type} variant="secondary" className="text-xs">
                        {g?.label ?? type}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> 修正する
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
