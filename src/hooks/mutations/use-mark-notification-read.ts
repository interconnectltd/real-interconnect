"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

interface NotificationRow {
  id: string;
  is_read: boolean;
  [k: string]: unknown;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.patch("/notifications", { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all });
      // 楽観更新: 該当 ids を is_read=true に。unread-count は -ids.length
      const previousMap = new Map<readonly unknown[], unknown>();
      queryClient
        .getQueriesData({ queryKey: queryKeys.notifications.all })
        .forEach(([key, old]) => {
          previousMap.set(key, old);
          if (Array.isArray(old)) {
            queryClient.setQueryData(
              key,
              (old as NotificationRow[]).map((n) =>
                ids.includes(n.id) ? { ...n, is_read: true } : n,
              ),
            );
          } else if (
            typeof old === "object" &&
            old !== null &&
            "count" in old
          ) {
            const cur = (old as { count: number }).count;
            queryClient.setQueryData(key, {
              ...(old as Record<string, unknown>),
              count: Math.max(0, cur - ids.length),
            });
          } else if (typeof old === "number") {
            queryClient.setQueryData(key, Math.max(0, old - ids.length));
          }
        });
      return { previousMap };
    },
    onError: (err, _ids, context) => {
      context?.previousMap.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
      showErrorToast(err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.patch("/notifications/read-all"),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all });
      // 全件 is_read=true、unread-count=0 に楽観更新
      const previousMap = new Map<readonly unknown[], unknown>();
      queryClient
        .getQueriesData({ queryKey: queryKeys.notifications.all })
        .forEach(([key, old]) => {
          previousMap.set(key, old);
          if (Array.isArray(old)) {
            queryClient.setQueryData(
              key,
              (old as NotificationRow[]).map((n) => ({ ...n, is_read: true })),
            );
          } else if (
            typeof old === "object" &&
            old !== null &&
            "count" in old
          ) {
            queryClient.setQueryData(key, {
              ...(old as Record<string, unknown>),
              count: 0,
            });
          } else if (typeof old === "number") {
            queryClient.setQueryData(key, 0);
          }
        });
      return { previousMap };
    },
    onError: (err, _vars, context) => {
      context?.previousMap.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
      showErrorToast(err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      toast.success("すべての通知を既読にしました");
    },
  });
}
