"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

export function useToggleBookmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      isBookmarked,
    }: {
      userId: string;
      isBookmarked: boolean;
    }) => {
      if (isBookmarked) {
        return api.delete(`/bookmarks?bookmarked_user_id=${userId}`);
      }
      return api.post("/bookmarks", { bookmarked_user_id: userId });
    },
    onSuccess: (_data, { isBookmarked }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
      toast.success(isBookmarked ? "ブックマークを解除しました" : "ブックマークに追加しました");
    },
    onError: showErrorToast,
  });
}
