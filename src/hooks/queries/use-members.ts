"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Profile } from "@/types";

interface MembersResponse {
  members: Profile[];
  meta: {
    page: number;
    totalPages: number;
    totalCount: number;
    /** 同義語辞書展開で検索を広げたかどうか (UIに「〇〇も含めて検索」表示用) */
    searchExpanded?: boolean;
    /** 実際に検索に使われたキーワード一覧 (元語 + 同義語) */
    searchTerms?: string[];
  };
}

export function useMembers(
  search: string,
  filters: { industry?: string; position?: string; sort?: string; page?: number } = {},
) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (filters.industry) params.set("industry", filters.industry);
  if (filters.position) params.set("position", filters.position);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.page) params.set("page", String(filters.page));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.members.list(search, filters),
    queryFn: ({ signal }) =>
      api.get<MembersResponse>(`/members${qs ? `?${qs}` : ""}`, { signal }),
  });
}
