"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";

export function useBookmarks() {
  return useQuery({
    queryKey: queryKeys.bookmarks.list(),
    queryFn: () => api.get("/bookmarks"),
  });
}
