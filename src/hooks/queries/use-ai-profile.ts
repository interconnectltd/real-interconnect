"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";

export function useAnalysisCount() {
  return useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => api.get<{ analysis_count: number }>("/profiles/me"),
    select: (data) => data.analysis_count ?? 0,
  });
}
