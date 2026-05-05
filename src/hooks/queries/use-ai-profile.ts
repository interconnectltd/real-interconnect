"use client";

import { useMyProfile } from "./use-profile";

/**
 * /profiles/me の analysis_count を派生させる hook。
 * useMyProfile と queryKey を共有 (= 重複 fetch ゼロ)。
 */
export function useAnalysisCount() {
  const { data, isLoading } = useMyProfile();
  return {
    data:
      ((data as unknown as { analysis_count?: number } | undefined)?.analysis_count) ?? 0,
    isLoading,
  };
}
