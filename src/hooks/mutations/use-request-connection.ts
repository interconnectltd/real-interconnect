"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

interface Connection {
  id: string;
  user_id: string;
  connected_user_id: string;
  status: "pending" | "accepted" | "declined" | "reaccepted";
}

/**
 * 楽観的更新: ボタン押下 → 即座に "申請中" バッジに切替 → API 完了後同期。
 * サーバー往復を待たないため体感速度が劇的に向上 (200-500ms → 0ms)。
 */
export function useRequestConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectedUserId: string) =>
      api.post("/connections", { connected_user_id: connectedUserId }),
    onMutate: async (connectedUserId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.connections.all });
      const previous = queryClient.getQueryData<Connection[]>(queryKeys.connections.all);
      // 楽観的に "pending" の connection を追加
      queryClient.setQueryData<Connection[]>(queryKeys.connections.all, (old) => {
        const optimistic: Connection = {
          id: `optimistic-${connectedUserId}`,
          user_id: "self",
          connected_user_id: connectedUserId,
          status: "pending",
        };
        return old ? [...old, optimistic] : [optimistic];
      });
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      toast.success("コネクション申請を送信しました");
    },
    onError: (err, _variables, context) => {
      // 失敗時はロールバック
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.connections.all, context.previous);
      }
      showErrorToast(err);
    },
  });
}
