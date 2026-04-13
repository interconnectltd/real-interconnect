"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";

export function useAnalysisCount() {
  return useQuery({
    queryKey: queryKeys.aiProfile.analysisCount(),
    queryFn: async () => {
      const profile = await api.get<{ analysis_count: number }>("/profiles/me");
      return profile.analysis_count ?? 0;
    },
  });
}
