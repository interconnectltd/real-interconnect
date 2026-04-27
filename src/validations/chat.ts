import { z } from "zod/v4";

export const sendMessageSchema = z.object({
  content: z.string().min(1, "メッセージを入力してください").max(5000, "メッセージは5000文字以内で入力してください"),
  content_type: z.enum(["text", "image", "file", "scheduling_card", "meeting_suggestion", "meeting_confirmed"]).default("text"),
});

export const createRoomSchema = z.object({
  connection_id: z.string().uuid("無効な接続IDです"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
