"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";
import type { ProfileUpdateInput } from "@/validations/profile";

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProfileUpdateInput) => api.patch("/profiles/me", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      // 完成度 extras も即時再計算 (avatar / consent / bio 変更が反映)
      queryClient.invalidateQueries({ queryKey: ["profile-completeness-extras"] });
      toast.success("プロフィールを更新しました");
    },
    onError: showErrorToast,
  });
}
