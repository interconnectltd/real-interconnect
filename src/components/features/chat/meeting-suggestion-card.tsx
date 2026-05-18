"use client";

import { useState } from "react";
import { Check, Loader2, X, Calendar, Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

interface MeetingSuggestionCardProps {
  suggestion: {
    intent: "confirmed" | "proposed";
    datetime: string | null;
    platform: "zoom" | "meet" | null;
    confidence: number;
  };
  roomId: string;
  currentUserId: string;
  otherUserId: string;
}

type CardState = "idle" | "creating" | "confirmed" | "dismissed";

function formatPlatformLabel(platform: "zoom" | "meet" | null): string | null {
  if (platform === "zoom") return "Zoom";
  if (platform === "meet") return "Google Meet";
  return null;
}

function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = weekdays[d.getDay()];
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${month}/${day} (${weekday}) ${hours}:${minutes}`;
}

export function MeetingSuggestionCard({
  suggestion,
  roomId,
  currentUserId,
  otherUserId,
}: MeetingSuggestionCardProps) {
  const [state, setState] = useState<CardState>("idle");

  if (state === "dismissed") {
    return null;
  }

  // Confirmed creation state
  if (state === "confirmed") {
    return (
      <Card
        size="sm"
        className="w-72 max-w-full border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
      >
        <CardContent className="flex items-center gap-2 pt-0">
          <Check className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800 dark:text-green-200">
            確定済み
            {suggestion.datetime && `: ${formatDateTimeJa(suggestion.datetime)}`}
          </span>
        </CardContent>
      </Card>
    );
  }

  const isConfirmed = suggestion.intent === "confirmed";
  const platformLabel = formatPlatformLabel(suggestion.platform);

  const handleCreate = async () => {
    if (!suggestion.datetime) return;
    setState("creating");
    try {
      // ★Wave12: /scheduling/confirm の正規 schema は { other_user_id, room_id, start, end, platform }
      // 旧 { target_user_id, scheduled_at, duration_min, chat_room_id } では 100% 400
      // platform は AI 推測なので manual 固定 (Calendar event 自動生成は SchedulingCard 側のみ)
      const start = suggestion.datetime;
      const end = new Date(
        new Date(suggestion.datetime).getTime() + 30 * 60_000,
      ).toISOString();
      await api.post("/scheduling/confirm", {
        other_user_id: otherUserId,
        room_id: roomId,
        start,
        end,
        platform: "manual",
      });
      setState("confirmed");
    } catch (e) {
      console.error("[meeting-suggestion-card] confirm failed", e);
      toast.error("操作に失敗しました");
      setState("idle");
    }
  };

  const handleStartScheduling = async () => {
    setState("creating");
    try {
      // Wave11 Y: PostMessageSchema は scheduling_card で payload 必須。
      // 旧実装は content に JSON.stringify した object を入れて payload 不在 → 400。
      await api.post(`/chat/rooms/${roomId}/messages`, {
        content: "日程調整カードを送信しました",
        content_type: "scheduling_card",
        payload: { target_user_id: otherUserId },
      });
      setState("dismissed");
    } catch (e) {
      console.error("[meeting-suggestion-card] scheduling_card send failed", e);
      toast.error("操作に失敗しました");
      setState("idle");
    }
  };

  return (
    <Card size="sm" className="w-72 max-w-full">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          {isConfirmed
            ? "ミーティングの予定を検知"
            : "ミーティングの提案を検知"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Date/time display */}
        {suggestion.datetime && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">
                {formatDateTimeJa(suggestion.datetime)}
                {!isConfirmed && (
                  <span className="ml-1 text-muted-foreground">(仮)</span>
                )}
              </span>
            </div>
            {isConfirmed && platformLabel && (
              <div className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span>{platformLabel}</span>
              </div>
            )}
          </div>
        )}

        {/* Confidence badge */}
        {suggestion.confidence >= 0.8 && (
          <Badge variant="secondary" className="text-[10px]">
            高い確度
          </Badge>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {isConfirmed ? (
            <Button
              size="sm"
              className="flex-1"
              disabled={state === "creating" || !suggestion.datetime}
              onClick={handleCreate}
            >
              {state === "creating" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "ミーティングを作成"
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              disabled={state === "creating"}
              onClick={handleStartScheduling}
            >
              {state === "creating" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "日程調整を開始"
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={state === "creating"}
            onClick={() => setState("dismissed")}
          >
            スキップ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Confirmed meeting display card with optional Meet/Zoom URL action */
import type { MeetingConfirmedPayload } from "@/types/calendar";

export function MeetingConfirmedCard({
  content,
  payload,
}: {
  content: string;
  payload?: MeetingConfirmedPayload | null;
}) {
  const lines = content.split("\n").filter(Boolean);

  // ★Wave13 R2 #5: Calendar 自動 Meet event 生成済の場合、 chat 上に「会議に参加」
  //   ボタンを出す。 旧実装は payload.meeting_url を全く使っておらず、 ユーザーは
  //   chat 確定通知を見ても Calendar アプリを別途開く動線になっていた。
  //   #6 サニタイズ: javascript:/data: 等の XSS 経路を防ぐため http/https のみ許可、
  //   manual_url 側 (server) でも validation 済だが描画層も多重防御。
  // ★Wave13 R3 #6: 過去 (start + 60s 経過) ミーティングは「会議に参加」非表示
  //   旧 Meet event は admin 削除 / Calendar 連携解除等で 404 / 権限エラーになり、
  //   chat 履歴にずっとボタンが残ると dead link を踏ませる UX 劣化。
  //   start +60s 後はボタンを出さない (グレースは時計ズレ吸収)。
  const isPast = (() => {
    if (!payload?.start) return false;
    const ms = new Date(payload.start).getTime();
    if (Number.isNaN(ms)) return false;
    // React Compiler の純粋性チェック対象だが、ここでは「再描画毎に最新時刻で
    // 判定する」のが意図 (副作用なし・読み取りのみ・冪等)。
    // eslint-disable-next-line
    return ms + 60_000 < Date.now();
  })();
  const safeMeetingUrl = (() => {
    if (isPast) return null;
    const raw = payload?.meeting_url;
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  })();

  return (
    <Card
      size="sm"
      className="w-72 max-w-full border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
    >
      <CardContent className="flex items-start gap-2 pt-0">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            ミーティングが確定しました
          </p>
          {lines.map((line, i) => (
            <p
              key={i}
              className="text-xs text-green-700 dark:text-green-300"
            >
              {line}
            </p>
          ))}
          {safeMeetingUrl && (
            <a
              href={safeMeetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex h-8 min-h-[44px] items-center gap-1.5 rounded-md bg-green-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 sm:min-h-0"
            >
              <Video className="h-3.5 w-3.5" aria-hidden="true" />
              会議に参加
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
