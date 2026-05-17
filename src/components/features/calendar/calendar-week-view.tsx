"use client";

import { useState, useMemo } from "react";
import {
  Calendar,
  Video,
  Clock,
  RefreshCw,
  Mic,
  MicOff,
  Users,
  Settings,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import {
  getWeekRange,
  formatWeekLabel,
  formatCalendarDate,
  formatCalendarTime,
} from "@/lib/calendar/date-helpers";

interface CalendarAttendee {
  email: string;
  name: string | null;
  response_status: string | null;
}

interface CalendarEvent {
  id: string;
  title: string | null;
  start: string;
  end: string;
  duration_min: number | null;
  platform: string | null;
  video_url: string | null;
  is_interconnect: boolean;
  recording_enabled: boolean;
  attendees: CalendarAttendee[];
}

export function CalendarWeekView() {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);

  const {
    data: calendarEvents,
    isLoading: isCalendarLoading,
    isError: isCalendarError,
    error: calendarError,
    refetch: refetchCalendar,
  } = useQuery({
    queryKey: ["calendar-events", weekRange.from, weekRange.to],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/calendar/events?from=${encodeURIComponent(weekRange.from)}&to=${encodeURIComponent(weekRange.to)}`,
      ),
  });

  // 旧: あらゆる error を「未接続」扱いにしていた → 401/500/network 断でも
  // 「Google カレンダー未接続」と誤誘導しユーザーを再接続地獄に追い込む。
  // 修正: ApiError の code === "NOT_CONNECTED" or status === 404 のみ未接続扱い。
  const calendarNotConnected = (() => {
    if (!isCalendarError || !calendarError) return false;
    const e = calendarError as { code?: string; status?: number };
    return e.code === "NOT_CONNECTED" || e.status === 404;
  })();

  const [syncingCalendar, setSyncingCalendar] = useState(false);

  async function handleSyncCalendar() {
    setSyncingCalendar(true);
    try {
      await api.post("/calendar/sync");
      await refetchCalendar();
      toast.success("カレンダーを同期しました");
    } catch {
      toast.error("カレンダー同期に失敗しました");
    } finally {
      setSyncingCalendar(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset((w) => w - 1)}
          >
            ← 前週
          </Button>
          <span className="text-sm font-medium">
            {formatWeekLabel(weekRange.from, weekRange.to)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset((w) => w + 1)}
          >
            翌週 →
          </Button>
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
              今週
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncCalendar}
          disabled={syncingCalendar}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${syncingCalendar ? "animate-spin" : ""}`}
          />
          同期
        </Button>
      </div>

      {calendarNotConnected ? (
        <NotConnectedState />
      ) : isCalendarLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : calendarEvents && calendarEvents.length > 0 ? (
        <div className="space-y-3">
          {calendarEvents.map((event) => (
            <CalendarEventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-6 sm:p-12 text-center">
      <Image
        src="/illustrations/empty-meetings.png"
        alt=""
        width={280}
        height={200}
        className="mx-auto h-auto w-full max-w-[240px]"
        aria-hidden="true"
        priority={false}
      />
      <p className="mt-3 text-sm font-medium">カレンダーイベントはありません</p>
      <p className="mt-1 text-xs text-muted-foreground">
        この週にはイベントがありません
      </p>
    </div>
  );
}

function NotConnectedState() {
  return (
    <div className="rounded-lg border border-dashed p-6 sm:p-12 text-center">
      <Image
        src="/illustrations/empty-meetings-calendar.png"
        alt=""
        width={240}
        height={180}
        className="mx-auto h-auto w-full max-w-[220px]"
        aria-hidden="true"
        priority={false}
      />
      <p className="mt-3 text-sm font-medium">カレンダー未接続</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Googleカレンダーを接続すると、予定がここに表示されます
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        render={<Link href="/settings" />}
      >
        <Settings className="mr-1.5 h-3.5 w-3.5" />
        設定ページで接続する
      </Button>
    </div>
  );
}

function CalendarEventCard({ event }: { event: CalendarEvent }) {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);
  const durationMin =
    event.duration_min ??
    Math.round((endDate.getTime() - startDate.getTime()) / 60000);

  const platformLabel =
    event.platform === "google_meet"
      ? "Google Meet"
      : event.platform === "zoom"
        ? "Zoom"
        : event.platform === "teams"
          ? "Microsoft Teams"
          : event.platform
            ? event.platform
            : null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">
                {event.title ?? "（タイトルなし）"}
              </p>
              {event.is_interconnect && (
                <Badge className="shrink-0 bg-primary/10 text-xs text-primary">
                  INTERCONNECT
                </Badge>
              )}
              {platformLabel && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  <Video className="mr-1 h-3 w-3" />
                  {platformLabel}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatCalendarDate(event.start)}
                <span className="ml-1">{formatCalendarTime(event.start)}</span>
              </span>
              {durationMin > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {durationMin}分
                </span>
              )}
            </div>

            {event.attendees.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5 shrink-0" />
                {event.attendees.slice(0, 5).map((a) => (
                  <span key={a.email} className="rounded bg-muted px-1.5 py-0.5">
                    {a.name ?? a.email}
                  </span>
                ))}
                {event.attendees.length > 5 && (
                  <span className="text-muted-foreground/60">
                    +{event.attendees.length - 5}名
                  </span>
                )}
              </div>
            )}

            {event.video_url && (
              <a
                href={event.video_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Video className="h-3 w-3" />
                ミーティングリンク
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Recording toggle: 表示専用 (mutation 未実装、誤発火防止のため disabled)。
              onClick を持たない見た目だけのボタンはプライバシー事故を招くので状態表示のみ。 */}
          {event.is_interconnect && (
            <div className="flex shrink-0 items-center">
              <Button
                size="sm"
                variant={event.recording_enabled ? "default" : "outline"}
                className="gap-1.5"
                disabled
                aria-disabled="true"
                title={
                  event.recording_enabled
                    ? "録音設定: オン (変更機能は近日対応予定)"
                    : "録音設定: オフ (変更機能は近日対応予定)"
                }
              >
                {event.recording_enabled ? (
                  <Mic className="h-3.5 w-3.5" />
                ) : (
                  <MicOff className="h-3.5 w-3.5" />
                )}
                <span className="text-xs">
                  {event.recording_enabled ? "録音オン" : "録音オフ"}
                </span>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
