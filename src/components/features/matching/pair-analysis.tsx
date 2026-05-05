"use client";

import { useMemo } from "react";
import { Loader2, Sparkles, ArrowRight, ArrowLeft, Users, RefreshCcw } from "lucide-react";
import { usePairMatching } from "@/hooks/queries/use-pair-matching";
import { Badge } from "@/components/ui/badge";
import { GOAL_TYPES } from "@/lib/constants";

interface PairAnalysisProps {
  /** 相手の userId */
  targetId: string;
  /** Accordion が開いている時のみ fetch 発火 */
  open: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  ai_primary: "会話分析",
  hybrid: "ハイブリッド",
  attribute_only: "プロフィール一致",
};

/**
 * Members ページのカード折り畳みで開く、AI 双方向マッチング分析。
 *
 *   1. 双方向 score (my→their / their→my)
 *   2. mutual バッジ (双方が threshold 超え)
 *   3. AI 推薦理由 (my_reasons / their_reasons)
 *   4. 共通領域 (相手が提供できる × 自分が求める / 自分が提供できる × 相手が求める)
 *   5. needs_compute / their_missing 別 fallback
 */
export function PairAnalysis({ targetId, open }: PairAnalysisProps) {
  const { data, isLoading, isError } = usePairMatching(targetId, open);

  // common_topics の label 解決を memo 化 (Persona E perf)
  const myWantLabels = useMemo(
    () => (data?.common_topics.my_want_they_have ?? []).map(goalLabel),
    [data?.common_topics.my_want_they_have],
  );
  const iOfferLabels = useMemo(
    () => (data?.common_topics.i_offer_they_want ?? []).map(goalLabel),
    [data?.common_topics.i_offer_they_want],
  );

  if (!open) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        AI が双方向の相性を分析中...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="rounded-md bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
        分析データを取得できませんでした。
      </p>
    );
  }

  // 自分→相手の score 未計算: ダッシュボードで再計算誘導
  if (data.needs_compute) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
        <RefreshCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          まだこの方とのマッチングは計算されていません。ダッシュボードを開くと自動で分析が始まります。
        </span>
      </div>
    );
  }

  const myScorePct = Math.round(data.my_score * 100);
  const theirScorePct = Math.round(data.their_score * 100);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      {/* 双方向スコア (393px でも 2 列維持) */}
      <div className="grid grid-cols-2 gap-2">
        <ScoreBlock
          label="あなた → この方"
          score={myScorePct}
          icon={ArrowRight}
          tone={scoreTone(myScorePct)}
        />
        <ScoreBlock
          label="この方 → あなた"
          score={theirScorePct}
          icon={ArrowLeft}
          tone={scoreTone(theirScorePct)}
          missing={data.their_missing}
        />
      </div>

      {/* mutual バッジ (トーン軟化: 「双方向で関心が一致」) */}
      {data.is_mutual && (
        <Badge
          variant="outline"
          className="gap-1 border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent-strong"
        >
          <Users className="h-3 w-3" aria-hidden="true" />
          双方向で関心が一致しています
        </Badge>
      )}

      {/* AI 推薦理由 (自分目線) */}
      {data.my_reasons.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Sparkles className="h-3 w-3 text-accent-strong" aria-hidden="true" />
            この方を勧める理由 (
            {PHASE_LABEL[data.phase] ?? "プロフィール一致"})
          </p>
          <ul className="space-y-1 pl-1">
            {data.my_reasons.slice(0, 3).map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 leading-relaxed text-muted-foreground"
              >
                <span
                  className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
                  aria-hidden="true"
                />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 相手目線の理由 (mutual の時のみ) */}
      {data.is_mutual && data.their_reasons.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Sparkles className="h-3 w-3 text-accent-strong" aria-hidden="true" />
            相手目線であなたを勧める理由
          </p>
          <ul className="space-y-1 pl-1">
            {data.their_reasons.slice(0, 3).map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 leading-relaxed text-muted-foreground"
              >
                <span
                  className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
                  aria-hidden="true"
                />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 共通領域 */}
      {(myWantLabels.length > 0 || iOfferLabels.length > 0) && (
        <div className="rounded-md border border-border bg-card p-2.5">
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            重なる領域
          </p>
          <div className="space-y-1.5">
            {myWantLabels.length > 0 && (
              <div>
                <span className="text-[11px] text-muted-foreground">
                  あなたが求める × 相手が提供できる:
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {myWantLabels.map((t, i) => (
                    <Badge
                      key={`mw-${i}`}
                      variant="outline"
                      className="h-5 border-accent/30 bg-accent/5 px-1.5 text-[11px] font-medium text-accent-strong"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {iOfferLabels.length > 0 && (
              <div>
                <span className="text-[11px] text-muted-foreground">
                  あなたが提供できる × 相手が求める:
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {iOfferLabels.map((t, i) => (
                    <Badge
                      key={`io-${i}`}
                      variant="outline"
                      className="h-5 border-primary/30 bg-primary/5 px-1.5 text-[11px] font-medium text-primary"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function goalLabel(type: string): string {
  const found = GOAL_TYPES.find((g) => g.value === type);
  return found?.label ?? type;
}

function scoreTone(pct: number): "low" | "mid" | "high" {
  if (pct >= 70) return "high";
  if (pct >= 40) return "mid";
  return "low";
}

function ScoreBlock({
  label,
  score,
  icon: Icon,
  tone,
  missing = false,
}: {
  label: string;
  score: number;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: "true" | "false";
  }>;
  tone: "low" | "mid" | "high";
  /** score が未計算 (their_missing) の時 true */
  missing?: boolean;
}) {
  const toneClass = missing
    ? "border-dashed border-border bg-muted/30 text-muted-foreground"
    : tone === "high"
      ? "border-accent/30 bg-accent/8 text-accent-strong"
      : tone === "mid"
        ? "border-border bg-card text-foreground"
        : "border-border bg-muted text-muted-foreground";
  return (
    <div className={`flex flex-col rounded-md border px-2.5 py-2 ${toneClass}`}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide opacity-70">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </div>
      {missing ? (
        <p className="mt-0.5 text-xs font-medium opacity-70">未計算</p>
      ) : (
        <p className="mt-0.5 text-base font-bold tabular-nums">
          {score}
          <span className="text-xs opacity-60">%</span>
        </p>
      )}
    </div>
  );
}
