"use client";

import { Calendar, Video, Clock, Check, X, User } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { useUIStore } from "@/stores/ui-store";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  proposed: { label: "リクエスト中", color: "bg-yellow-100 text-yellow-800" },
  confirmed: { label: "確定", color: "bg-green-100 text-green-800" },
  completed: { label: "完了", color: "bg-muted text-muted-foreground" },
  cancelled: { label: "キャンセル", color: "bg-red-100 text-red-800" },
  no_show: { label: "不参加", color: "bg-red-100 text-red-800" },
};

export default function MeetingsPage() {
  const queryClient = useQueryClient();
  const { openProfileModal } = useUIStore();

  const { data: meetings, isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<unknown[]>("/meetings"),
  });

  const updateMeeting = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/meetings/${id}`, { status }),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(
        status === "confirmed" ? "会議を承認しました" : "会議を辞退しました",
      );
    },
    onError: () => toast.error("更新に失敗しました"),
  });

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
      ) : meetings && meetings.length > 0 ? (
        <div className="space-y-3">
          {meetings.map((item: any) => {
            const meeting = item.meeting;
            const otherParticipant = item.other_participant;
            if (!meeting) return null;
            const status = STATUS_LABELS[meeting.status] ?? { label: meeting.status, color: "bg-muted" };

            return (
              <Card key={meeting.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{meeting.title ?? "会議"}</p>
                        <Badge className={`text-xs ${status.color}`}>{status.label}</Badge>
                      </div>
                      {otherParticipant && (
                        <p className="text-xs text-muted-foreground">
                          {otherParticipant.company && `${otherParticipant.company} / `}
                          {otherParticipant.position ?? ""}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/60">
                        日程は連絡先を通じて調整してください
                      </p>
                    </div>

                    <div className="flex gap-2">
                      {meeting.status === "proposed" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => updateMeeting.mutate({ id: meeting.id, status: "confirmed" })}
                            disabled={updateMeeting.isPending}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            承認
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateMeeting.mutate({ id: meeting.id, status: "cancelled" })}
                            disabled={updateMeeting.isPending}
                          >
                            <X className="mr-1 h-3.5 w-3.5" />
                            辞退
                          </Button>
                        </>
                      )}
                      {meeting.status === "confirmed" && otherParticipant && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openProfileModal(otherParticipant.id)}
                        >
                          <User className="mr-1 h-3.5 w-3.5" />
                          プロフィールを見る
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Calendar className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">会議はまだありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            マッチングページから会議をリクエストできます
          </p>
        </div>
      )}
    </div>
  );
}
