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
      // ["connections"] prefix 全キャッシュを cancel (list filter ありなし両対応)
      await queryClient.cancelQueries({ queryKey: queryKeys.connections.all });

      // 旧: setQueryData(["connections"], ...) → useConnections() は ["connections","list",...]
      //     を読んでおり key 不一致で楽観更新が UI に当たらない
      // 新: setQueriesData で prefix match → ["connections","list",*] 全キャッシュに適用
      const optimistic: Connection = {
        id: `optimistic-${connectedUserId}`,
        user_id: "self",
        connected_user_id: connectedUserId,
        status: "pending",
      };
      const previousMap = new Map<readonly unknown[], Connection[] | undefined>();
      queryClient
        .getQueriesData<Connection[]>({ queryKey: queryKeys.connections.all })
        .forEach(([key, data]) => {
          previousMap.set(key, data);
          queryClient.setQueryData<Connection[]>(
            key,
            data ? [...data, optimistic] : [optimistic],
          );
        });
      return { previousMap };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      toast.success("コネクション申請を送信しました");
    },
    onError: (err, _variables, context) => {
      // 失敗時はロールバック (全キャッシュ)
      context?.previousMap.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
      showErrorToast(err);
    },
  });
}
