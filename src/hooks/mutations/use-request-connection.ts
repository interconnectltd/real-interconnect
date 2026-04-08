"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

export function useRequestConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectedUserId: string) =>
      api.post("/connections", { connected_user_id: connectedUserId }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.connections.all });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      toast.success("コネクション申請を送信しました");
    },
    onError: showErrorToast,
  });
}
