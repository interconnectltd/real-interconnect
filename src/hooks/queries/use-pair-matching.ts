"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSupabase } from "@/providers/supabase-provider";

export interface PairMatchingResult {
  target_profile: {
    id: string;
    name: string;
    company: string | null;
    position: string | null;
    industry: string | null;
    bio: string | null;
    avatar_url: string | null;
  };
  my_score: number;
  their_score: number;
  is_mutual: boolean;
  my_reasons: string[];
  their_reasons: string[];
  my_confidence: number | null;
  phase: "attribute_only" | "hybrid" | "ai_primary" | string;
  common_topics: {
    my_want_they_have: string[];
    i_offer_they_want: string[];
  };
  needs_compute: boolean;
  their_missing: boolean;
}

/**
 * 自分と特定相手 (targetId) の双方向マッチング分析を取得。
 * Members ページの折り畳みカードを開いた瞬間に発火し、5min cache。
 *
 * queryKey に viewer (= user.id) を含める事で他ユーザー切替時の
 * cache 漏れを防ぐ (Persona E security 指摘)。
 */
export function usePairMatching(
  targetId: string | null | undefined,
  enabled: boolean,
) {
  const { user } = useSupabase();
  const viewerId = user?.id ?? null;
  return useQuery({
    queryKey: ["matching", "pair", viewerId, targetId],
    queryFn: () => api.get<PairMatchingResult>(`/matching/pair/${targetId}`),
    enabled: Boolean(targetId) && Boolean(viewerId) && enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
