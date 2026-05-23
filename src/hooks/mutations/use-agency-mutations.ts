"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";
import type { ReferralLinkRow } from "@/hooks/queries/use-agency";

export function useApplyAgency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { applicant_note?: string }) =>
      api.post<{ id: string; status: string; created_at: string }>(
        "/agency/apply",
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agency.applicationMe() });
      qc.invalidateQueries({ queryKey: queryKeys.agency.me() });
      toast.success("代理店申請を送信しました");
    },
    onError: (err) => showErrorToast(err),
  });
}

export function useCreateReferralLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string }) =>
      api.post<{ link: ReferralLinkRow }>("/agency/links", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agency.links() });
      toast.success("紹介リンクを発行しました");
    },
    onError: (err) => showErrorToast(err),
  });
}

export function useUpdateReferralLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      label?: string | null;
      is_active?: boolean;
    }) =>
      api.patch<{ link: ReferralLinkRow }>(`/agency/links/${vars.id}`, {
        label: vars.label,
        is_active: vars.is_active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agency.links() });
      toast.success("更新しました");
    },
    onError: (err) => showErrorToast(err),
  });
}

export interface PayoutInfoInput {
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
}

export function useUpdatePayoutInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      payout_method: "bank_transfer";
      payout_info: PayoutInfoInput;
    }) => api.patch<{ ok: true }>("/agency/payout-info", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agency.me() });
      toast.success("振込先情報を保存しました");
    },
    onError: (err) => showErrorToast(err),
  });
}
