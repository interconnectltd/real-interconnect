"use client";

import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/queries/use-notifications";
import {
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/hooks/mutations/use-mark-notification-read";
import { useUpdateConnection } from "@/hooks/mutations/use-update-connection";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { NOTIFICATION_ACTION_WHITELIST } from "@/lib/constants";
import type { Notification, NotificationAction } from "@/types";

export default function NotificationsPage() {
  const router = useRouter();
  const { data: notifications, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const updateConnection = useUpdateConnection();
  const queryClient = useQueryClient();
  const updateMeeting = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/meetings/${id}`, { status }),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      toast.success(
        status === "confirmed" ? "会議を承認しました" : "会議を辞退しました",
      );
    },
    onError: () => {
      toast.error("更新に失敗しました");
    },
  });

  const unreadCount = notifications?.filter((n: Notification) => !n.is_read).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">通知</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount}件の未読通知` : "すべて既読です"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            すべて既読
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : notifications && notifications.length > 0 ? (
        <div className="space-y-1">
          {notifications.map((n: Notification) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted cursor-pointer",
                !n.is_read && "bg-primary/5",
              )}
              onClick={() => {
                if (!n.is_read) markRead.mutate([n.id]);
                if (n.link) router.push(n.link);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (!n.is_read) markRead.mutate([n.id]);
                  if (n.link) router.push(n.link);
                }
              }}
            >
              <Bell
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  n.is_read ? "text-muted-foreground" : "text-primary",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", !n.is_read && "font-medium")}>
                  {n.title}
                </p>
                <p className="text-xs text-muted-foreground">{n.message}</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {new Date(n.created_at).toLocaleString("ja-JP")}
                </p>
                {/* Action buttons — only show on unread notifications */}
                {!n.is_read && n.actions && Array.isArray(n.actions) && n.actions.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {(n.actions as NotificationAction[])
                      .filter((a) => NOTIFICATION_ACTION_WHITELIST.has(a.type))
                      .map((action) => (
                        <Button
                          key={action.type}
                          size="sm"
                          variant={action.type === "accept" ? "default" : "outline"}
                          disabled={updateConnection.isPending || updateMeeting.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              (action.type === "accept" || action.type === "reject") &&
                              action.payload?.connectionId
                            ) {
                              updateConnection.mutate({
                                id: action.payload.connectionId,
                                status: action.type === "accept" ? "accepted" : "declined",
                              });
                              markRead.mutate([n.id]);
                            } else if (
                              (action.type === "accept" || action.type === "reject") &&
                              action.payload?.meetingId
                            ) {
                              updateMeeting.mutate({
                                id: action.payload.meetingId,
                                status: action.type === "accept" ? "confirmed" : "cancelled",
                              });
                              markRead.mutate([n.id]);
                            } else if (action.href) {
                              router.push(action.href);
                            }
                          }}
                        >
                          {action.label}
                        </Button>
                      ))}
                  </div>
                )}
              </div>
              {!n.is_read && (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">通知はまだありません</p>
        </div>
      )}
    </div>
  );
}
