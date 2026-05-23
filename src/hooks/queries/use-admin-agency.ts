"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "./keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

export interface AdminAgencyApplication {
  id: string;
  status: "pending" | "approved" | "rejected";
  applicant_note: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  applicant: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    avatar_url: string | null;
  } | null;
}

export function useAdminAgencyApplications(
  status: "pending" | "approved" | "rejected" | "all" = "pending",
) {
  return useQuery({
    queryKey: queryKeys.adminAgency.applications(status),
    queryFn: () =>
      api.get<{ applications: AdminAgencyApplication[] }>(
        `/admin/agency/applications?status=${status}`,
      ),
  });
}

export function useReviewAgencyApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      action: "approve" | "reject";
      admin_note?: string;
    }) =>
      api.patch<{ id: string; status: string }>(
        `/admin/agency/applications/${vars.id}`,
        { action: vars.action, admin_note: vars.admin_note },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAgency.all });
      toast.success(vars.action === "approve" ? "承認しました" : "却下しました");
    },
    onError: (err) => showErrorToast(err),
  });
}

export function useSuspendAgency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      userId: string;
      action: "suspend" | "unsuspend";
      admin_note?: string;
    }) =>
      api.patch<{ user_id: string; status: string }>(
        `/admin/agency/agencies/${vars.userId}/suspend`,
        { action: vars.action, admin_note: vars.admin_note },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAgency.all });
      toast.success(vars.action === "suspend" ? "停止しました" : "再開しました");
    },
    onError: (err) => showErrorToast(err),
  });
}
