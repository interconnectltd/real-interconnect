"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api-client";
import { useUIStore } from "@/stores/ui-store";

interface Subscription {
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
}

export function useSubscriptionGate() {
  const openUpgradeDialog = useUIStore((s) => s.openUpgradeDialog);

  const { data, isLoading } = useQuery({
    queryKey: ["subscription-me"],
    queryFn: ({ signal }) =>
      api.get<{ subscription: Subscription | null }>("/billing/subscription", {
        signal,
      }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const status = data?.subscription?.status ?? null;
  const isSubscribed = status === "active" || status === "trialing";

  const guard = useCallback(
    (action: () => void) => {
      if (isSubscribed) {
        action();
      } else {
        openUpgradeDialog();
      }
    },
    [isSubscribed, openUpgradeDialog],
  );

  return { isSubscribed, isLoading, guard };
}
