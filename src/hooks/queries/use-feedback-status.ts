"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import { api } from "@/lib/api-client";

/**
 * Returns a map of target_id -> true for connections the user has already rated.
 * Used to hide the "評価する" button on connections that already have feedback.
 */
export function useFeedbackStatus() {
  return useQuery({
    queryKey: queryKeys.feedback.all,
    queryFn: async () => {
      const data = await api.get<{ target_id: string }[]>("/feedback");
      const map: Record<string, boolean> = {};
      for (const row of data) {
        map[row.target_id] = true;
      }
      return map;
    },
  });
}
