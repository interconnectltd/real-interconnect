"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

interface RequestMeetingPayload {
  target_id: string;
  message?: string;
  proposed_times?: string;
}

export function useRequestMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RequestMeetingPayload) =>
      api.post("/meetings/request", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetings.all });
      toast.success("会議リクエストを送信しました");
    },
    onError: showErrorToast,
  });
}
