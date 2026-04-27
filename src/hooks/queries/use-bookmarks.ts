"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";

export function useBookmarks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.bookmarks.list(),
    queryFn: () => api.get("/bookmarks"),
    enabled: options?.enabled,
  });
}
