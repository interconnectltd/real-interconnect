"use client";

import { useMyProfile } from "./use-profile";

/**
 * /profiles/me の analysis_count を派生させる hook。
 * useMyProfile と queryKey を共有 (= 重複 fetch ゼロ)。
 */
export function useAnalysisCount() {
  const { data, isLoading } = useMyProfile();
  return {
    data: data?.analysis_count ?? 0,
    lastAnalyzedAt: data?.last_analyzed_at ?? null,
    isLoading,
  };
}
