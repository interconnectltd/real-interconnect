"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Notification } from "@/types";

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: queryKeys.notifications.list(unreadOnly),
    queryFn: () =>
      api.get<Notification[]>(
        `/notifications${unreadOnly ? "?unread=true" : ""}`,
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: async () => {
      const data = await api.get<Notification[]>("/notifications?unread=true");
      return data.length;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
