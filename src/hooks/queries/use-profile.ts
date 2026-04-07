"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Profile } from "@/types";

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profile.detail(id ?? ""),
    queryFn: () => api.get<Profile>(`/profiles/${id}`),
    enabled: !!id,
  });
}

export function useMyProfile() {
  return useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => api.get<Profile>("/profiles/me"),
  });
}
