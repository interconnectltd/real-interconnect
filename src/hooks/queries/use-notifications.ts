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
    // TODO: Replace with a dedicated count endpoint (e.g. GET /notifications/count)
    // to avoid fetching full notification objects just for a count.
    queryFn: async ({ signal }) => {
      const data = await api.get<Notification[]>("/notifications?unread=true", {
        signal,
      });
      return data.length;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
