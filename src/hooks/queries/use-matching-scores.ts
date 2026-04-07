"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { MatchScore, MutualMatch } from "@/types";

interface MatchFilter extends Record<string, unknown> {
  sort?: "score" | "recent";
  minScore?: number;
  page?: number;
}

export function useMatchingScores(filter: MatchFilter = {}) {
  const params = new URLSearchParams();
  if (filter.sort) params.set("sort", filter.sort);
  if (filter.minScore) params.set("min_score", String(filter.minScore));
  if (filter.page) params.set("page", String(filter.page));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.matching.scores(filter),
    queryFn: () => api.get<MatchScore[]>(`/matching/scores${qs ? `?${qs}` : ""}`),
  });
}

export function useMutualMatches() {
  return useQuery({
    queryKey: queryKeys.matching.mutual(),
    queryFn: () => api.get<MutualMatch[]>("/matching/mutual"),
  });
}
