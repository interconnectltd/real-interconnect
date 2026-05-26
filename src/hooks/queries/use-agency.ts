"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";

export interface AgencyMe {
  user_id: string;
  status: "pending" | "approved" | "suspended" | "rejected";
  applied_at: string;
  approved_at: string | null;
  suspended_at: string | null;
  total_clicks: number;
  total_referrals: number;
  total_earnings_jpy: number;
  current_balance_jpy: number;
  current_rank: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  commission_rate: number;
  payout_method: string | null;
  min_withdrawal_jpy: number;
  active_referral_count: number;
  created_at: string;
  updated_at: string;
}

export interface AgencyApplication {
  id: string;
  status: "pending" | "approved" | "rejected";
  applicant_note: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralLinkRow {
  id: string;
  code: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  click_count: number;
  referral_count: number;
}

export interface ReferralRow {
  id: string;
  status: "signed_up" | "paying" | "churned" | "refunded";
  signed_up_at: string;
  first_payment_at: string | null;
  churned_at: string | null;
  referral_link: { id: string; code: string; label: string | null } | null;
  referred_user: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    avatar_url: string | null;
  } | null;
}

export interface ClicksByLink {
  link_id: string;
  total: number;
  unique_visitors: number;
  conversions: number;
}

export interface DailyClicks {
  date: string;
  clicks: number;
}

export function useAgencyMe(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.agency.me(),
    queryFn: () => api.get<{ agency: AgencyMe | null }>("/agency/me"),
    enabled: options?.enabled,
  });
}

export function useAgencyApplication() {
  return useQuery({
    queryKey: queryKeys.agency.applicationMe(),
    queryFn: () =>
      api.get<{ application: AgencyApplication | null }>("/agency/apply"),
  });
}

export function useAgencyLinks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.agency.links(),
    queryFn: () => api.get<{ links: ReferralLinkRow[] }>("/agency/links"),
    enabled: options?.enabled,
  });
}

export function useAgencyReferrals(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.agency.referrals(),
    queryFn: () => api.get<{ referrals: ReferralRow[] }>("/agency/referrals"),
    enabled: options?.enabled,
  });
}

export function useAgencyClicks(days = 30, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...queryKeys.agency.clicks(), days] as const,
    queryFn: () =>
      api.get<{
        days: number;
        by_link: ClicksByLink[];
        daily: DailyClicks[];
      }>(`/agency/clicks?days=${days}`),
    enabled: options?.enabled,
  });
}
