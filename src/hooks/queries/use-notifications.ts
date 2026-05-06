"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Notification } from "@/types";

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: queryKeys.notifications.list(unreadOnly),
    queryFn: ({ signal }) =>
      api.get<Notification[]>(
        `/notifications${unreadOnly ? "?unread=true" : ""}`,
        { signal },
      ),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    // 専用 endpoint で count のみ取得 (旧実装は全件 payload 転送で N+payload 肥大)
    queryFn: async ({ signal }) => {
      const data = await api.get<{ unread: number }>(
        "/notifications/count",
        { signal },
      );
      return data.unread;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
