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
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.connections.all });
      const previous = queryClient.getQueryData(queryKeys.connections.all);
      queryClient.setQueryData(queryKeys.connections.all, (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return old.map((conn: Record<string, unknown>) =>
          conn.id === id ? { ...conn, status } : conn,
        );
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.connections.all, context.previous);
      }
      showErrorToast(err);
    },
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
  });
}
