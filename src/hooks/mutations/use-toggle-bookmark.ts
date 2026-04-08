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
    onMutate: async ({ userId, isBookmarked }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.bookmarks.all });
      const previous = queryClient.getQueryData(queryKeys.bookmarks.all);
      queryClient.setQueryData(queryKeys.bookmarks.all, (old: unknown) => {
        if (!Array.isArray(old)) return old;
        if (isBookmarked) {
          return old.filter(
            (b: Record<string, unknown>) => b.bookmarked_user_id !== userId,
          );
        }
        return [...old, { bookmarked_user_id: userId }];
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.bookmarks.all, context.previous);
      }
      showErrorToast(err);
    },
    onSuccess: (_data, { isBookmarked }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
      toast.success(
        isBookmarked
          ? "ブックマークを解除しました"
          : "ブックマークに追加しました",
      );
    },
  });
}
