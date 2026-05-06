/**
 * Chat validators 単体テスト。
 * R2-R5 Sec/TS レビュー指摘の入力検証を回帰テストで担保。
 */
import { describe, expect, it } from "vitest";
import {
  PostMessageSchema,
  GetMessagesQuerySchema,
  ReadSchema,
} from "./chat";

describe("PostMessageSchema", () => {
  it("text content_type で content 必須", () => {
    const r = PostMessageSchema.safeParse({
      content: "hello",
      content_type: "text",
    });
    expect(r.success).toBe(true);
  });

  it("空 content は text で reject", () => {
    const r = PostMessageSchema.safeParse({
      content: "",
      content_type: "text",
    });
    expect(r.success).toBe(false);
  });

  it("scheduling_card は payload 必須", () => {
    const r = PostMessageSchema.safeParse({
      content: "提案",
      content_type: "scheduling_card",
    });
    expect(r.success).toBe(false);
  });

  it("scheduling_card + payload で OK", () => {
    const r = PostMessageSchema.safeParse({
      content: "提案",
      content_type: "scheduling_card",
      payload: { suggestion_id: "abc" },
    });
    expect(r.success).toBe(true);
  });

  it("不正な content_type は reject", () => {
    const r = PostMessageSchema.safeParse({
      content: "x",
      content_type: "evil",
    });
    expect(r.success).toBe(false);
  });

  it("content 4001 文字は reject", () => {
    const r = PostMessageSchema.safeParse({
      content: "a".repeat(4001),
      content_type: "text",
    });
    expect(r.success).toBe(false);
  });
});

describe("GetMessagesQuerySchema", () => {
  it("limit 未指定で default 30", () => {
    const r = GetMessagesQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(30);
  });

  it("limit=NaN フォールバックで default 30 (TS R1: NaN limit 穴)", () => {
    const r = GetMessagesQuerySchema.safeParse({ limit: "abc" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(30);
  });

  it("limit=51 は max 50 で reject", () => {
    const r = GetMessagesQuerySchema.safeParse({ limit: 51 });
    expect(r.success).toBe(false);
  });

  it("before_id が UUID でないと reject", () => {
    const r = GetMessagesQuerySchema.safeParse({
      limit: 10,
      before_at: "2026-05-06T00:00:00Z",
      before_id: "not-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("有効な UUID + ISO は OK", () => {
    const r = GetMessagesQuerySchema.safeParse({
      limit: 10,
      before_at: "2026-05-06T00:00:00Z",
      before_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });
});

describe("ReadSchema", () => {
  it("空 body OK", () => {
    const r = ReadSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("up_to_message_id 不正 UUID は reject", () => {
    const r = ReadSchema.safeParse({ up_to_message_id: "x" });
    expect(r.success).toBe(false);
  });

  it("up_to_message_id 有効 UUID OK", () => {
    const r = ReadSchema.safeParse({
      up_to_message_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });
});
