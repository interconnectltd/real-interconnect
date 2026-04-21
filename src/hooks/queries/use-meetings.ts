"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";

export function useMeetings() {
  return useQuery({
    queryKey: queryKeys.meetings.list(),
    queryFn: () => api.get<unknown[]>("/meetings"),
  });
}
