"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api-client";

/**
 * connection_id から chat room を取得 (or 作成) し /chat?room=... へ遷移する共通 hook。
 *
 * 旧: connections/page.tsx の handleChat に inline 実装されていた
 *     room create → 失敗時 fallback (rooms list で connection_id 一致を探す)
 *     のロジックを集約。matching/members/dashboard/profile-modal/notifications
 *     から「チャットを開く」を呼ぶ際に使用。
 */
export function useOpenChatRoom() {
  const router = useRouter();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      try {
        const room = await api.post<{ id: string }>("/chat/rooms", {
          connection_id: connectionId,
        });
        return room.id;
      } catch {
        // Room already exists の可能性 → list から connection_id 一致を探す
        const rooms = await api.get<
          Array<{ id: string; connection_id: string }>
        >("/chat/rooms");
        const existing = rooms.find((r) => r.connection_id === connectionId);
        if (!existing) throw new Error("チャットルームが見つかりません");
        return existing.id;
      }
    },
    onSuccess: (roomId) => {
      router.push(`/chat?room=${roomId}`);
    },
    onError: () => {
      toast.error("チャットの開始に失敗しました");
    },
  });
}
