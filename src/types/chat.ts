/**
 * src/types/chat.ts
 *
 * Chat 機能の SSOT (Single Source of Truth)。
 * - ChatContentType: chat_messages.content_type の Union を Database 型から派生
 * - CHAT_CONTENT_TYPES: ランタイム validation 用 const tuple
 * - isChatContentType: type guard
 * - ChatMessage / ChatRoom: Row 型エイリアス
 *
 * 5 観点並列レビュー (TS 64/100) で SSOT 違反を指摘されたため新設。
 * 既存 src/types/database.ts の chat_messages / chat_rooms 型を派生。
 */

import type { Database } from "@/types/database";

// ─────────────────────────────────────────────
// Row 型エイリアス
// ─────────────────────────────────────────────
export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
export type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"];
export type ChatMessageInsert =
  Database["public"]["Tables"]["chat_messages"]["Insert"];

// ─────────────────────────────────────────────
// content_type SSOT
// ─────────────────────────────────────────────
export type ChatContentType = ChatMessage["content_type"];

/**
 * VALID_CONTENT_TYPES として route で使う const tuple。
 * `as const satisfies` で Database 型と完全一致を強制。
 */
export const CHAT_CONTENT_TYPES = [
  "text",
  "image",
  "file",
  "scheduling_card",
  "meeting_suggestion",
  "meeting_confirmed",
] as const satisfies readonly ChatContentType[];

/**
 * Type guard: unknown -> ChatContentType narrowing
 */
export function isChatContentType(v: unknown): v is ChatContentType {
  return (
    typeof v === "string" &&
    (CHAT_CONTENT_TYPES as readonly string[]).includes(v)
  );
}

// ─────────────────────────────────────────────
// API response shape (cursor pagination 対応)
// ─────────────────────────────────────────────
export type ChatMessagesResponse = {
  messages: ChatMessage[];
  next_cursor: string | null; // ISO timestamp + id の複合 cursor
  has_more: boolean;
};

// ─────────────────────────────────────────────
// scheduling_card / meeting_suggestion 用 payload schema (Phase B 準備)
// ─────────────────────────────────────────────
export type SchedulingPayload = {
  schema_version: 1;
  suggestion_id: string;
  proposed_slots: Array<{ start: string; end: string }>;
  duration_min: number;
  location: { type: "google_meet" | "zoom_pmi"; url?: string };
  expires_at: string;
  status: "pending" | "accepted" | "rejected" | "expired";
};

export type MeetingConfirmedPayload = {
  schema_version: 1;
  calendar_event_id: string;
  meeting_url: string;
  start: string;
  end: string;
  ics_url?: string;
};

// 制限値
export const MAX_CONTENT_LEN = 4000;
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 30;
