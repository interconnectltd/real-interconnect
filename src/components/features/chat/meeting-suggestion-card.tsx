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
      await api.post("/scheduling/confirm", {
        target_user_id: otherUserId,
        scheduled_at: suggestion.datetime,
        duration_min: 30,
        platform: suggestion.platform === "meet" ? "google_meet" : suggestion.platform,
        chat_room_id: roomId,
      });
      setState("confirmed");
    } catch {
      toast.error("操作に失敗しました");
      setState("idle");
    }
  };

  const handleStartScheduling = async () => {
    setState("creating");
    try {
      await api.post(`/chat/rooms/${roomId}/messages`, {
        content: JSON.stringify({ target_user_id: otherUserId }),
        content_type: "scheduling_card",
      });
      setState("dismissed");
    } catch {
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

/** Simple confirmed meeting display card */
export function MeetingConfirmedCard({ content }: { content: string }) {
  // content from the API contains lines like:
  // "日時: 2026年4月29日(火) 14:00\n時間: 30分\nプラットフォーム: Zoom"
  const lines = content.split("\n").filter(Boolean);

  return (
    <Card
      size="sm"
      className="w-72 max-w-full border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
    >
      <CardContent className="flex items-start gap-2 pt-0">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <div className="space-y-0.5">
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
        </div>
      </CardContent>
    </Card>
  );
}
