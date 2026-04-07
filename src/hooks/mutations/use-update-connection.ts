"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/connections/${id}`, { status }),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });

      const messages: Record<string, string> = {
        accepted: "コネクションを承認しました",
        declined: "コネクション申請をお断りしました",
        disconnected: "コネクションを解除しました",
        blocked: "ユーザーをブロックしました",
        cancelled: "コネクション申請を取り消しました",
      };
      toast.success(messages[status] ?? "更新しました");
    },
    onError: showErrorToast,
  });
}
