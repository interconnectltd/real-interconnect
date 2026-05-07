"use client";

/**
 * ConnectionRequestContext
 *
 * 通知カード内に「相手のプロフィール + マッチ理由 + スコア」を展開表示するセクション。
 * `/api/v1/notifications/[id]/context` から lazy 取得。
 *
 * 設計判断:
 *   - 旧 UI は title/message 文字列のみで承認可否を判断できなかった
 *   - 経営者マッチングは「誰なのか / なぜマッチしたのか」が承認の最重要シグナル
 *   - フル profile-modal を開く前段で、意思決定に必要な最小情報を inline で見せる
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { ScoreBar, ReasonList } from "@/components/shared/score-bar";
import { ConnectedActions } from "@/components/shared/connected-actions";
import { useUIStore } from "@/stores/ui-store";
import { api } from "@/lib/api-client";

interface ContextResponse {
  notification: { id: string; type: string };
  connection: {
    id: string;
    status: string;
    created_at: string;
    requester_id: string;
  } | null;
  profile: {
    id: string;
    name: string;
    avatar_url: string | null;
    company: string | null;
    position: string | null;
    industry: string | null;
    bio: string | null;
  } | null;
  match: {
    total_score: number;
    reasons: string[] | null;
    phase: "attribute_only" | "hybrid" | "ai_primary" | string;
    confidence: number;
    calculated_at: string;
  } | null;
}

const PHASE_LABEL: Record<string, string> = {
  attribute_only: "プロフィール一致",
  hybrid: "会話分析を含む",
  ai_primary: "会話分析（高精度）",
};

export function ConnectionRequestContext({
  notificationId,
  onExpand,
}: {
  notificationId: string;
  /** 展開時のコールバック (親側で markRead を呼ぶ用) */
  onExpand?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { openProfileModal } = useUIStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notification-context", notificationId],
    queryFn: () =>
      api.get<ContextResponse>(`/notifications/${notificationId}/context`),
    enabled: expanded,
    staleTime: 60_000,
  });

  return (
    <div
      className="mt-2 rounded-md border border-border/60 bg-card/50"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => {
            // 展開した瞬間に既読化 (UX 期待値: 中身を見たので未読でなくなる)
            if (!v) onExpand?.();
            return !v;
          });
        }}
        aria-expanded={expanded}
        aria-controls={`ctx-${notificationId}`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
          {expanded ? "詳細を閉じる" : "相手のプロフィールとマッチ理由を見る"}
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div
          id={`ctx-${notificationId}`}
          className="border-t border-border/60 p-3"
        >
          {isLoading && (
            <div
              className="flex items-center justify-center py-6"
              role="status"
            >
              <Loader2
                className="h-4 w-4 animate-spin text-muted-foreground"
                aria-label="読み込み中"
              />
            </div>
          )}

          {isError && (
            <p className="text-xs text-destructive">
              詳細の取得に失敗しました
            </p>
          )}

          {data && !data.profile && (
            <p className="text-xs text-muted-foreground">
              相手のプロフィール情報を取得できませんでした (相手が退会済の可能性があります)。
            </p>
          )}

          {data?.profile && (
            <div className="space-y-3">
              {/* プロフィール基本情報 (アバター・名前タップで詳細モーダル) */}
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => data.profile && openProfileModal(data.profile.id)}
                  className="shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 hover:opacity-90 active:opacity-75"
                  aria-label={`${data.profile.name} の詳細プロフィールを開く`}
                >
                  <UserAvatar
                    name={data.profile.name}
                    avatarUrl={data.profile.avatar_url}
                    size="md"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => data.profile && openProfileModal(data.profile.id)}
                    className="block text-left text-sm font-semibold text-foreground underline-offset-2 transition hover:text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                    aria-label={`${data.profile.name} の詳細プロフィールを開く`}
                  >
                    {data.profile.name}
                  </button>
                  {(data.profile.company || data.profile.position) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[data.profile.company, data.profile.position]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  )}
                  {data.profile.industry && (
                    <Badge
                      variant="outline"
                      className="mt-1.5 h-5 border-accent/25 bg-accent/5 px-2 text-[11px] font-medium text-accent-strong"
                    >
                      {data.profile.industry}
                    </Badge>
                  )}
                </div>
              </div>

              {/* bio */}
              {data.profile.bio && (
                <p className="line-clamp-3 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {data.profile.bio}
                </p>
              )}

              {/* マッチ理由・スコア */}
              {data.match && (
                <div className="space-y-2 rounded border border-accent/20 bg-accent/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-accent-strong">
                      なぜこの方とマッチしたか
                    </span>
                    <Badge
                      variant="outline"
                      className="h-5 border-accent/30 bg-card px-2 text-[10px] font-medium text-accent-strong"
                    >
                      {PHASE_LABEL[data.match.phase] ?? data.match.phase}
                    </Badge>
                  </div>
                  <ScoreBar
                    label="マッチ度"
                    score={data.match.total_score}
                    preliminary={data.match.confidence < 0.5}
                  />
                  {data.match.reasons && data.match.reasons.length > 0 && (
                    <ReasonList reasons={data.match.reasons} />
                  )}
                </div>
              )}
              {!data.match && (
                <p className="rounded border border-dashed border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  自動マッチ分析の結果はまだ計算されていません。プロフィールから判断してください。
                </p>
              )}

              {/* accepted/reaccepted ならその場でチャット/日程動線を提供 */}
              {data.connection &&
                (data.connection.status === "accepted" ||
                  data.connection.status === "reaccepted") &&
                data.profile && (
                  <ConnectedActions
                    connectionId={data.connection.id}
                    targetUserId={data.profile.id}
                    variant="modal"
                    onRequestMeeting={(id) => openProfileModal(id)}
                  />
                )}

              {/* 詳細プロフィールへのリンク (常設) */}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    data.profile &&
                    openProfileModal(data.profile.id)
                  }
                >
                  <ExternalLink
                    className="mr-1.5 h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  詳細プロフィールを開く
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
