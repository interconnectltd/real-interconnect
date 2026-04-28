"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TimeSlot {
  date: string;
  start: string;
  end: string;
  score: number;
}

interface SchedulingCardProps {
  roomId: string;
  targetUserId: string;
  currentUserId: string;
}

type CardState = "loading" | "selecting" | "manual" | "confirming" | "confirmed" | "error";

function formatSlotDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function formatTimeRange(start: string, end: string): string {
  return `${start}\u301C${end}`;
}

export function SchedulingCard({
  roomId,
  targetUserId,
  currentUserId,
}: SchedulingCardProps) {
  const [state, setState] = useState<CardState>("loading");
  const [suggestions, setSuggestions] = useState<TimeSlot[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [confirmedSlot, setConfirmedSlot] = useState<TimeSlot | null>(null);
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");

  const fetchSuggestions = useCallback(async () => {
    setState("loading");
    try {
      const data = await api.post<{ suggestions: TimeSlot[] }>(
        "/scheduling/suggest",
        { target_user_id: targetUserId, duration_min: 30 },
      );
      if (data.suggestions.length === 0) {
        setState("error");
      } else {
        setSuggestions(data.suggestions);
        setState("selecting");
      }
    } catch {
      setState("error");
    }
  }, [targetUserId]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleConfirm = async (slot: TimeSlot) => {
    setState("confirming");
    try {
      const proposedTime = `${slot.date} ${slot.start}`;
      await api.post("/meetings/request", {
        target_id: targetUserId,
        proposed_times: [proposedTime],
        message: `${formatSlotDate(slot.date)} ${slot.start}に会議を設定しました`,
      });
      setConfirmedSlot(slot);
      setState("confirmed");
    } catch {
      toast.error("リクエストに失敗しました");
      setState("selecting");
    }
  };

  const handleManualConfirm = async () => {
    if (!manualDate || !manualTime) return;
    const slot: TimeSlot = {
      date: manualDate,
      start: manualTime,
      end: manualTime, // end is approximate; server handles duration
      score: 0,
    };
    await handleConfirm(slot);
  };

  // Confirmed state
  if (state === "confirmed" && confirmedSlot) {
    return (
      <Card size="sm" className="w-64 max-w-full border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
        <CardContent className="flex items-center gap-2 pt-0">
          <Check className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800 dark:text-green-200">
            確定済み: {formatSlotDate(confirmedSlot.date)} {confirmedSlot.start}
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm" className="w-72 max-w-full">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Calendar className="h-4 w-4" />
          日程調整
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Loading */}
        {state === "loading" && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">空き時間を検索中...</span>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="py-3">
            <p className="text-xs text-muted-foreground">
              共通の空き時間が見つかりませんでした
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setState("manual")}
            >
              手動で日時を指定
            </Button>
          </div>
        )}

        {/* Slot selection */}
        {(state === "selecting" || state === "confirming") && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">おすすめの日時:</p>
            <div className="space-y-1.5">
              {suggestions.map((slot, i) => (
                <label
                  key={`${slot.date}-${slot.start}`}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                    selectedIndex === i
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name={`slot-${roomId}`}
                    checked={selectedIndex === i}
                    onChange={() => setSelectedIndex(i)}
                    disabled={state === "confirming"}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="font-medium">{formatSlotDate(slot.date)}</span>
                  <span className="text-muted-foreground">
                    {formatTimeRange(slot.start, slot.end)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1"
                disabled={state === "confirming"}
                onClick={() => {
                  const slot = suggestions[selectedIndex];
                  if (slot) handleConfirm(slot);
                }}
              >
                {state === "confirming" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "この日程で決定"
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={state === "confirming"}
                onClick={() => setState("manual")}
              >
                別の日時を提案
              </Button>
            </div>
          </div>
        )}

        {/* Manual entry */}
        {state === "manual" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">希望の日時を入力:</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                type="time"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={!manualDate || !manualTime}
                onClick={handleManualConfirm}
              >
                この日程で決定
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (suggestions.length > 0) {
                    setState("selecting");
                  } else {
                    fetchSuggestions();
                  }
                }}
              >
                戻る
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
