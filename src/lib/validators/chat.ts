/**
 * src/lib/validators/chat.ts
 *
 * Chat API 用 Zod schema。
 * 5 観点並列レビュー (TS 64/100) で「body: any」を指摘されたため新設。
 *
 * - PostMessageSchema: POST /messages の body validation
 * - ReadSchema: POST /read の body validation
 * - GetMessagesQuery: GET /messages の query string validation
 */

import { z } from "zod";
import {
  CHAT_CONTENT_TYPES,
  MAX_CONTENT_LEN,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  isChatContentType,
  type ChatContentType,
} from "@/types/chat";

const ContentTypeSchema = z
  .string()
  .refine(isChatContentType, "content_type が不正です")
  .transform((v) => v as ChatContentType);

const ChatPayloadSchema = z
  .object({})
  .passthrough()
  .nullable()
  .optional();

/**
 * POST /api/v1/chat/rooms/[roomId]/messages
 * - text 系: content 必須、payload は空
 * - scheduling_card 等: payload 必須、content は説明文 (オプション)
 */
export const PostMessageSchema = z
  .object({
    content: z
      .string()
      .trim()
      .max(MAX_CONTENT_LEN, `本文は ${MAX_CONTENT_LEN} 文字以内です`),
    content_type: ContentTypeSchema.default(
      "text" as ChatContentType,
    ),
    payload: ChatPayloadSchema,
  })
  .superRefine((val, ctx) => {
    const isStructured =
      val.content_type === "scheduling_card" ||
      val.content_type === "meeting_suggestion" ||
      val.content_type === "meeting_confirmed";

    if (isStructured) {
      if (!val.payload) {
        ctx.addIssue({
          code: "custom",
          path: ["payload"],
          message: `${val.content_type} には payload が必須です`,
        });
      }
    } else {
      if (!val.content || val.content.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["content"],
          message: "本文が空です",
        });
      }
    }
  });

export type PostMessageInput = z.infer<typeof PostMessageSchema>;

/**
 * GET /api/v1/chat/rooms/[roomId]/messages
 *   ?limit=30&before_at=ISO&before_id=UUID
 * cursor pagination tie-break: created_at + id の複合
 */
export const GetMessagesQuerySchema = z.object({
  limit: z
    .preprocess(
      (v) => {
        if (v === undefined || v === null || v === "") return DEFAULT_PAGE_SIZE;
        const n = Number(v);
        return Number.isFinite(n) ? n : DEFAULT_PAGE_SIZE;
      },
      z.number().int().min(1).max(MAX_PAGE_SIZE),
    )
    .default(DEFAULT_PAGE_SIZE),
  before_at: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
  before_id: z.uuid().nullable().optional(),
});

export type GetMessagesQuery = z.infer<typeof GetMessagesQuerySchema>;

/**
 * POST /api/v1/chat/rooms/[roomId]/read
 *   { up_to_message_id?: UUID }  (省略時は room 内未読全て)
 */
export const ReadSchema = z
  .object({
    up_to_message_id: z.uuid().nullable().optional(),
  })
  .default({});

export type ReadInput = z.infer<typeof ReadSchema>;
