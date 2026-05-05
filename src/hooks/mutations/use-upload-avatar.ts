"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { ApiError } from "@/lib/errors";
import { toast } from "sonner";
import type { Profile, ApiResponse } from "@/types";

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<Profile> => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/profiles/avatar", {
        method: "POST",
        body: formData,
      });

      const json = (await res.json()) as ApiResponse<Profile>;

      if (!res.ok || json.error) {
        throw new ApiError(
          res.status,
          json.error?.code ?? "UNKNOWN",
          json.error?.message ?? "エラーが発生しました",
        );
      }

      return json.data as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      queryClient.invalidateQueries({ queryKey: ["profile-completeness-extras"] });
      toast.success("アバターを更新しました");
    },
    onError: showErrorToast,
  });
}
