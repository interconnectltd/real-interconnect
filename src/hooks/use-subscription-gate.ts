"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api-client";
import { useUIStore } from "@/stores/ui-store";
import {
  resolveMembershipTier,
  hasFullAccess,
  type MembershipTier,
  type ManualPlan,
} from "@/lib/membership";

interface Subscription {
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
}

interface SubscriptionResponse {
  subscription: Subscription | null;
  manual_plan?: ManualPlan;
}

export function useSubscriptionGate() {
  const openUpgradeDialog = useUIStore((s) => s.openUpgradeDialog);

  const { data, isLoading } = useQuery({
    queryKey: ["subscription-me"],
    queryFn: ({ signal }) =>
      api.get<SubscriptionResponse>("/billing/subscription", {
        signal,
      }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const tier: MembershipTier = resolveMembershipTier({
    manual_plan: data?.manual_plan ?? null,
    subscription_status: data?.subscription?.status ?? null,
    current_period_end: data?.subscription?.current_period_end ?? null,
  });
  const isSubscribed = hasFullAccess(tier);

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

  return { isSubscribed, isLoading, tier, guard };
}
