"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

interface ConnectionRow {
  id: string;
  status: string;
  [k: string]: unknown;
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/connections/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.connections.all });

      // prefix match で ["connections", *] 全キャッシュ更新
      // 旧: setQueryData(connections.all=["connections"]) → useConnections() は
      //     connections.list({status})=["connections","list",{status}] を読む
      //     キー不一致で楽観更新ゼロ反映だった
      const previousMap = new Map<readonly unknown[], unknown>();
      queryClient
        .getQueriesData<ConnectionRow[]>({ queryKey: queryKeys.connections.all })
        .forEach(([key, old]) => {
          previousMap.set(key, old);
          if (!Array.isArray(old)) return;
          // タブ key の status filter 引数を取り出す (例: ["connections","list",{status:"pending"}])
          const filterStatus =
            (key[2] as { status?: string } | undefined)?.status;
          const updated = old.map((c) => (c.id === id ? { ...c, status } : c));
          // 「pending → accepted」遷移時に pending タブからは消し、
          // accepted タブには表示する (filter 不一致なら除外、一致なら残置)
          const next = filterStatus
            ? updated.filter((c) => c.status === filterStatus)
            : updated;
          queryClient.setQueryData(key, next);
        });
      return { previousMap };
    },
    onError: (err, _vars, context) => {
      context?.previousMap.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
      showErrorToast(err);
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      // 接続状態の変更でcontact_infoの可視性が変わるため、プロフィールキャッシュも無効化
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
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
