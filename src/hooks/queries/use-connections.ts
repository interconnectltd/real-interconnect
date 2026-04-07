"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Connection } from "@/types";

export function useConnections(status?: string) {
  const filter = status ? { status } : undefined;
  const params = status ? `?status=${status}` : "";

  return useQuery({
    queryKey: queryKeys.connections.list(filter),
    queryFn: () => api.get<Connection[]>(`/connections${params}`),
  });
}
