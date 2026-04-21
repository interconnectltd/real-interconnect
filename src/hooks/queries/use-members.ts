"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Profile } from "@/types";

interface MembersResponse {
  members: Profile[];
  meta: { page: number; totalPages: number; totalCount: number };
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
    queryFn: () => api.get<MembersResponse>(`/members${qs ? `?${qs}` : ""}`),
  });
}
