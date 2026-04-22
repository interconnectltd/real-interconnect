"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

interface SubmitFeedbackParams {
  target_id: string;
  rating: number;
  value_tags?: string[];
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: SubmitFeedbackParams) =>
      api.post("/feedback", params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feedback.all });
      toast.success("フィードバックを送信しました");
    },
    onError: (err) => {
      showErrorToast(err);
    },
  });
}
