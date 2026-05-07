"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/hooks/queries/keys";
import { showErrorToast } from "@/lib/errors-client";
import { toast } from "sonner";

interface BookmarkRow {
  bookmarked_user_id: string;
  [k: string]: unknown;
}

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

      // prefix match で ["bookmarks", *] 全キャッシュに楽観更新
      // 旧: setQueryData(bookmarks.all=["bookmarks"]) → useBookmarks は
      //     bookmarks.list()=["bookmarks","list"] を読むためキー不一致で
      //     楽観更新が UI に当たらず invalidate 完了 (200-500ms) まで残った。
      const previousMap = new Map<readonly unknown[], unknown>();
      queryClient
        .getQueriesData<BookmarkRow[]>({ queryKey: queryKeys.bookmarks.all })
        .forEach(([key, old]) => {
          previousMap.set(key, old);
          if (!Array.isArray(old)) return;
          const next: BookmarkRow[] = isBookmarked
            ? old.filter((b) => b.bookmarked_user_id !== userId)
            : [...old, { bookmarked_user_id: userId }];
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
