"use client";

import { useState, useMemo } from "react";
import {
  Calendar,
  Video,
  Clock,
  Check,
  X,
  User,
  ExternalLink,
  Ban,
  CheckCircle2,
  RefreshCw,
  Mic,
  MicOff,
  Users,
  CalendarX2,
  Settings,
  Download,
} from "lucide-react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { useUIStore } from "@/stores/ui-store";
import { toast } from "sonner";
import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
} from "@/lib/calendar/links";
import {
  getWeekRange,
  formatWeekLabel,
  formatCalendarDate,
  formatCalendarTime,
} from "@/lib/calendar/date-helpers";

/* ---------- types ---------- */

interface Meeting {
  id: string;
  title: string | null;
  scheduled_at: string | null;
  duration_min: number | null;
  platform: string | null;
  meeting_url: string | null;
  status: string;
  request: {
    requester_id: string;
    target_id: string;
    message: string | null;
  }[] | null;
}

interface OtherParticipant {
  id: string;
  name: string | null;
  company: string | null;
  position: string | null;
}

interface MeetingItem {
  meeting_id: string;
  role: string;
  meeting: Meeting;
  other_participant: OtherParticipant | null;
}

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

/* ---------- constants ---------- */

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  proposed: { label: "リクエスト中", color: "bg-yellow-100 text-yellow-800" },
  confirmed: { label: "確定", color: "bg-green-100 text-green-800" },
  completed: { label: "完了", color: "bg-muted text-muted-foreground" },
  cancelled: { label: "キャンセル", color: "bg-red-100 text-red-800" },
  no_show: { label: "不参加", color: "bg-red-100 text-red-800" },
};

const PLATFORM_LABELS: Record<string, string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
  other: "その他",
};

type TabValue = "proposed" | "confirmed" | "done" | "calendar";

/* ---------- helpers ---------- */

function getPlatformIcon(platform: string | null) {
  return <Video className="h-3.5 w-3.5" />;
}

/* ---------- component ---------- */

export default function MeetingsPage() {
  const queryClient = useQueryClient();
  const { openProfileModal } = useUIStore();
  const [weekOffset, setWeekOffset] = useState(0);

  const { data: meetings, isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<MeetingItem[]>("/meetings"),
  });

  const updateMeeting = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/meetings/${id}`, { status }),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      const msgs: Record<string, string> = {
        confirmed: "会議を承認しました",
        cancelled: "会議をキャンセルしました",
        completed: "会議を完了にしました",
      };
      toast.success(msgs[status] ?? "更新しました");
    },
    onError: () => toast.error("更新に失敗しました"),
  });

  // Calendar events
  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const {
    data: calendarEvents,
    isLoading: isCalendarLoading,
    isError: isCalendarError,
    refetch: refetchCalendar,
  } = useQuery({
    queryKey: ["calendar-events", weekRange.from, weekRange.to],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/calendar/events?from=${encodeURIComponent(weekRange.from)}&to=${encodeURIComponent(weekRange.to)}`,
      ),
  });

  // Treat 404 / no-data as "not connected" for the empty state
  const calendarNotConnected = isCalendarError;
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

  // Categorise meetings
  const proposed = (meetings ?? []).filter(
    (m) => m.meeting?.status === "proposed",
  );
  const confirmed = (meetings ?? []).filter(
    (m) => m.meeting?.status === "confirmed",
  );
  const done = (meetings ?? []).filter(
    (m) =>
      m.meeting?.status === "completed" ||
      m.meeting?.status === "cancelled" ||
      m.meeting?.status === "no_show",
  );

  /* ---------- render helpers ---------- */

  function renderEmpty(tab: TabValue) {
    const messages: Record<TabValue, { title: string; sub: string }> = {
      proposed: {
        title: "提案中の会議はありません",
        sub: "マッチングページから会議をリクエストできます",
      },
      confirmed: {
        title: "確定済みの会議はありません",
        sub: "提案が承認されるとここに表示されます",
      },
      done: {
        title: "完了した会議はありません",
        sub: "過去の会議履歴がここに表示されます",
      },
      calendar: {
        title: "カレンダーイベントはありません",
        sub: "この週にはイベントがありません",
      },
    };
    const msg = messages[tab];
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <Calendar className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">{msg.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{msg.sub}</p>
      </div>
    );
  }

  function renderMeetingCard(item: MeetingItem) {
    const meeting = item.meeting;
    const otherParticipant = item.other_participant;
    if (!meeting) return null;

    const status =
      STATUS_LABELS[meeting.status] ?? {
        label: meeting.status,
        color: "bg-muted",
      };
    const isRequester = item.role === "requester";
    const isTarget = item.role === "target";
    const isDone =
      meeting.status === "completed" ||
      meeting.status === "cancelled" ||
      meeting.status === "no_show";

    return (
      <Card key={meeting.id}>
        <CardContent className="p-4">
          {/* Header: title + badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">
                  {meeting.title ?? "会議"}
                </p>
                <Badge className={`shrink-0 text-xs ${status.color}`}>
                  {status.label}
                </Badge>
              </div>

              {/* Other participant */}
              {otherParticipant && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => openProfileModal(otherParticipant.id)}
                >
                  <User className="h-3.5 w-3.5" />
                  <span>
                    {otherParticipant.name ??
                      ([otherParticipant.company, otherParticipant.position]
                        .filter(Boolean)
                        .join(" / ") ||
                      "相手")}
                  </span>
                  {otherParticipant.company && (
                    <span className="text-muted-foreground/60">
                      ({otherParticipant.company}
                      {otherParticipant.position &&
                        ` / ${otherParticipant.position}`}
                      )
                    </span>
                  )}
                </button>
              )}

              {/* Details row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {/* Date & time */}
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatCalendarDate(meeting.scheduled_at)}
                  {meeting.scheduled_at && (
                    <span className="ml-1">{formatCalendarTime(meeting.scheduled_at)}</span>
                  )}
                </span>

                {/* Duration */}
                {meeting.duration_min && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {meeting.duration_min}分
                  </span>
                )}

                {/* Platform */}
                {meeting.platform && (
                  <span className="flex items-center gap-1">
                    {getPlatformIcon(meeting.platform)}
                    {PLATFORM_LABELS[meeting.platform] ?? meeting.platform}
                  </span>
                )}
              </div>

              {/* Meeting URL (only for confirmed meetings with a URL) */}
              {meeting.status === "confirmed" && meeting.meeting_url && (
                <a
                  href={meeting.meeting_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  {getPlatformIcon(meeting.platform)}
                  ミーティングリンク
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {/* カレンダーに追加 (confirmed + scheduled_at) */}
              {meeting.status === "confirmed" && meeting.scheduled_at && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    カレンダーに追加:
                  </span>
                  <a
                    href={generateGoogleCalendarUrl({
                      id: meeting.id,
                      title: meeting.title,
                      scheduled_at: meeting.scheduled_at,
                      duration_min: meeting.duration_min,
                      platform: meeting.platform,
                      meeting_url: meeting.meeting_url,
                      participants: otherParticipant?.name
                        ? [otherParticipant.name]
                        : undefined,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Google
                  </a>
                  <a
                    href={generateOutlookCalendarUrl({
                      id: meeting.id,
                      title: meeting.title,
                      scheduled_at: meeting.scheduled_at,
                      duration_min: meeting.duration_min,
                      platform: meeting.platform,
                      meeting_url: meeting.meeting_url,
                      participants: otherParticipant?.name
                        ? [otherParticipant.name]
                        : undefined,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Outlook
                  </a>
                  <a
                    href={`/api/v1/meetings/${meeting.id}/ics`}
                    download
                    className="inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    iCal
                  </a>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              {/* Proposed as target: accept / decline */}
              {meeting.status === "proposed" && isTarget && (
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      updateMeeting.mutate({
                        id: meeting.id,
                        status: "confirmed",
                      })
                    }
                    disabled={updateMeeting.isPending}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    承認
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMeeting.mutate({
                        id: meeting.id,
                        status: "cancelled",
                      })
                    }
                    disabled={updateMeeting.isPending}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    辞退
                  </Button>
                </>
              )}

              {/* Proposed as requester: cancel */}
              {meeting.status === "proposed" && isRequester && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateMeeting.mutate({
                      id: meeting.id,
                      status: "cancelled",
                    })
                  }
                  disabled={updateMeeting.isPending}
                >
                  <Ban className="mr-1 h-3.5 w-3.5" />
                  キャンセル
                </Button>
              )}

              {/* Confirmed: join + complete + cancel */}
              {meeting.status === "confirmed" && (
                <>
                  {meeting.meeting_url && (
                    <a
                      href={meeting.meeting_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] border border-transparent bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground transition-all hover:bg-primary/80"
                    >
                      <Video className="h-3.5 w-3.5" />
                      参加する
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMeeting.mutate({
                        id: meeting.id,
                        status: "completed",
                      })
                    }
                    disabled={updateMeeting.isPending}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    完了にする
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMeeting.mutate({
                        id: meeting.id,
                        status: "cancelled",
                      })
                    }
                    disabled={updateMeeting.isPending}
                  >
                    <Ban className="mr-1 h-3.5 w-3.5" />
                    キャンセル
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderCalendarNotConnected() {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <CalendarX2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
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

  function renderCalendarEventCard(event: CalendarEvent) {
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
      <Card key={event.id}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              {/* Title + badges */}
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
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-xs"
                  >
                    <Video className="mr-1 h-3 w-3" />
                    {platformLabel}
                  </Badge>
                )}
              </div>

              {/* Date/time & duration */}
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

              {/* Attendees */}
              {event.attendees.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  {event.attendees.slice(0, 5).map((a) => (
                    <span
                      key={a.email}
                      className="rounded bg-muted px-1.5 py-0.5"
                    >
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

              {/* Video link */}
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

            {/* Recording toggle for INTERCONNECT meetings */}
            {event.is_interconnect && (
              <div className="flex shrink-0 items-center">
                <Button
                  size="sm"
                  variant={event.recording_enabled ? "default" : "outline"}
                  className="gap-1.5"
                  title={
                    event.recording_enabled
                      ? "録音オン"
                      : "録音オフ"
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

  /* ---------- main render ---------- */

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">会議</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          あなたの会議スケジュール
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <Tabs defaultValue="proposed">
          <TabsList>
            <TabsTrigger value="proposed">
              提案中
              {proposed.length > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-200 px-1.5 text-xs font-semibold text-yellow-900">
                  {proposed.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="confirmed">
              確定済み
              {confirmed.length > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-green-200 px-1.5 text-xs font-semibold text-green-900">
                  {confirmed.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="done">
              完了
              {done.length > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
                  {done.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="calendar">
              カレンダー
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proposed">
            {proposed.length > 0 ? (
              <div className="space-y-3">
                {proposed.map((item) => renderMeetingCard(item))}
              </div>
            ) : (
              renderEmpty("proposed")
            )}
          </TabsContent>

          <TabsContent value="confirmed">
            {confirmed.length > 0 ? (
              <div className="space-y-3">
                {confirmed.map((item) => renderMeetingCard(item))}
              </div>
            ) : (
              renderEmpty("confirmed")
            )}
          </TabsContent>

          <TabsContent value="done">
            {done.length > 0 ? (
              <div className="space-y-3">
                {done.map((item) => renderMeetingCard(item))}
              </div>
            ) : (
              renderEmpty("done")
            )}
          </TabsContent>

          <TabsContent value="calendar">
            {/* Week navigation + sync button */}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setWeekOffset(0)}
                  >
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

            {/* Content */}
            {calendarNotConnected ? (
              renderCalendarNotConnected()
            ) : isCalendarLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-24 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            ) : calendarEvents && calendarEvents.length > 0 ? (
              <div className="space-y-3">
                {calendarEvents.map((event) =>
                  renderCalendarEventCard(event),
                )}
              </div>
            ) : (
              renderEmpty("calendar")
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
