/**
 * src/types/chat.ts の SSOT テスト。
 * R1 TS レビューで指摘された SSOT 違反 / type guard 漏れの回帰防止。
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_CONTENT_TYPES,
  isChatContentType,
  MAX_CONTENT_LEN,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from "./chat";

describe("CHAT_CONTENT_TYPES", () => {
  it("6 種類", () => {
    expect(CHAT_CONTENT_TYPES.length).toBe(6);
  });

  it("'text' を含む", () => {
    expect(CHAT_CONTENT_TYPES.includes("text")).toBe(true);
  });

  it("'meeting_confirmed' を含む", () => {
    expect(CHAT_CONTENT_TYPES.includes("meeting_confirmed")).toBe(true);
  });
});

describe("isChatContentType", () => {
  it("'text' を許可", () => {
    expect(isChatContentType("text")).toBe(true);
  });

  it("'evil' を拒否", () => {
    expect(isChatContentType("evil")).toBe(false);
  });

  it("undefined を拒否", () => {
    expect(isChatContentType(undefined)).toBe(false);
  });

  it("number を拒否", () => {
    expect(isChatContentType(123)).toBe(false);
  });

  it("null を拒否", () => {
    expect(isChatContentType(null)).toBe(false);
  });
});

describe("制限値定数", () => {
  it("MAX_CONTENT_LEN = 4000", () => {
    expect(MAX_CONTENT_LEN).toBe(4000);
  });

  it("MAX_PAGE_SIZE = 50", () => {
    expect(MAX_PAGE_SIZE).toBe(50);
  });

  it("DEFAULT_PAGE_SIZE = 30", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(30);
  });
});
