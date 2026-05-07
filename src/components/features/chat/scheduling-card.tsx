"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * SchedulingCard
 *
 * Wave11 Y で API 整合性を全面修復:
 *   旧実装は /scheduling/suggest を `target_user_id` で叩いていたが API は `other_user_id` 期待 → 400
 *   旧実装は response `data.suggestions` を期待だが API は `{ slots: [{ start, end }] }` 返却
 *   旧実装は確定で /meetings/request を叩いていたが正しくは /scheduling/confirm
 *
 * 新仕様:
 *   - send: { other_user_id, duration_min: 30 }
 *   - recv: { slots: [{ start: ISO, end: ISO }], proposer_has_calendar, target_has_calendar }
 *   - confirm: POST /scheduling/confirm { other_user_id, room_id, start, end, platform }
 */

interface ApiSlot {
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

interface SchedulingCardProps {
  roomId: string;
  targetUserId: string;
  currentUserId: string;
}

type CardState = "loading" | "selecting" | "manual" | "confirming" | "confirmed" | "error";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatRange(slot: ApiSlot): string {
  return `${formatTime(slot.start)}〜${formatTime(slot.end)}`;
}

export function SchedulingCard({
  roomId,
  targetUserId,
  currentUserId: _currentUserId,
}: SchedulingCardProps) {
  void _currentUserId; // 将来 self-message 判定用、現状未使用
  const [state, setState] = useState<CardState>("loading");
  const [slots, setSlots] = useState<ApiSlot[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [confirmedSlot, setConfirmedSlot] = useState<ApiSlot | null>(null);
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");

  const fetchSuggestions = useCallback(async () => {
    setState("loading");
    try {
      // ★ field 名を API 仕様に整合 (旧 target_user_id → other_user_id)
      const data = await api.post<{
        slots: ApiSlot[];
        proposer_has_calendar: boolean;
        target_has_calendar: boolean;
      }>("/scheduling/suggest", {
        other_user_id: targetUserId,
        duration_min: 30,
      });
      // ★ response 形 (旧 suggestions → slots)
      if (!data.slots || data.slots.length === 0) {
        setState("error");
      } else {
        setSlots(data.slots);
        setState("selecting");
      }
    } catch (e) {
      console.error("[scheduling-card] suggest failed", e);
      setState("error");
    }
  }, [targetUserId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleConfirm = async (slot: ApiSlot) => {
    setState("confirming");
    try {
      // 1) まず Google Meet 連携で確定試行 (Calendar 連携済 user は自動 Meet event 生成)
      await api.post("/scheduling/confirm", {
        other_user_id: targetUserId,
        room_id: roomId,
        start: slot.start,
        end: slot.end,
        platform: "google_meet",
      });
      setConfirmedSlot(slot);
      setState("confirmed");
    } catch (e) {
      const errCode = (e as { code?: string } | null)?.code;
      const errMsg = (e as { message?: string } | null)?.message ?? "";
      // ★Wave13 R3 #5: 直近 5 分以内に別日程確定済 → 409 ALREADY_CONFIRMED
      //   ユーザーは「やり直し」操作の dead-end に陥らないよう専用メッセージで誘導。
      if (errCode === "ALREADY_CONFIRMED") {
        toast.error(errMsg || "直近で別の日程が確定済みです");
        setState("selecting");
        return;
      }
      // 2) Calendar 未連携時 (400 CALENDAR_NOT_CONNECTED) は manual platform で fallback
      //    → 日時のみ確定、 meeting URL は user が後で共有する設計 (Wave12)
      if (errCode === "CALENDAR_NOT_CONNECTED") {
        try {
          await api.post("/scheduling/confirm", {
            other_user_id: targetUserId,
            room_id: roomId,
            start: slot.start,
            end: slot.end,
            platform: "manual",
          });
          setConfirmedSlot(slot);
          setState("confirmed");
          toast.info(
            "日程を確定しました。Google Calendar 未連携のため Meet URL は後で共有してください。",
          );
          return;
        } catch (e2) {
          console.error("[scheduling-card] manual fallback failed", e2);
        }
      }
      console.error("[scheduling-card] confirm failed", e);
      toast.error(
        "会議の確定に失敗しました。時間を置いて再試行してください。",
      );
      setState("selecting");
    }
  };

  const handleManualConfirm = async () => {
    if (!manualDate || !manualTime) return;
    // local datetime を ISO + local offset で確定 (Asia/Tokyo 想定)
    // browser の Date constructor は local time として解釈するので OK
    const startLocal = new Date(`${manualDate}T${manualTime}`);
    if (Number.isNaN(startLocal.getTime())) {
      toast.error("日時の形式が不正です");
      return;
    }
    const endLocal = new Date(startLocal.getTime() + 30 * 60_000); // 30 min default
    const slot: ApiSlot = {
      start: startLocal.toISOString(),
      end: endLocal.toISOString(),
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
            確定済み: {formatDate(confirmedSlot.start)} {formatTime(confirmedSlot.start)}
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
        {state === "loading" && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">空き時間を検索中...</span>
          </div>
        )}

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

        {(state === "selecting" || state === "confirming") && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">おすすめの日時:</p>
            <div className="space-y-1.5">
              {slots.map((slot, i) => (
                <label
                  key={`${slot.start}`}
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
                  <span className="font-medium">{formatDate(slot.start)}</span>
                  <span className="text-muted-foreground">{formatRange(slot)}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1"
                disabled={state === "confirming"}
                onClick={() => {
                  const slot = slots[selectedIndex];
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

        {state === "manual" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">希望の日時を入力:</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="h-11 flex-1 rounded-md border border-border bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                type="time"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
                className="h-11 w-24 rounded-md border border-border bg-background px-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                  if (slots.length > 0) {
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
