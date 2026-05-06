/**
 * api-helpers の純関数テスト。
 * R5 で追加した sha256Hex の決定性を担保 (Idempotency body_hash 検証用)。
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./api-helpers";

describe("sha256Hex", () => {
  it("空文字列の hash が決定的", async () => {
    const h = await sha256Hex("");
    expect(h).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("'hello' の hash が決定的", async () => {
    const h = await sha256Hex("hello");
    expect(h).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("日本語も同じ入力で同じ hash", async () => {
    const a = await sha256Hex("こんにちは");
    const b = await sha256Hex("こんにちは");
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  it("異なる入力は異なる hash", async () => {
    const a = await sha256Hex("a");
    const b = await sha256Hex("b");
    expect(a).not.toBe(b);
  });

  it("hash は 64 文字 hex", async () => {
    const h = await sha256Hex("test123");
    expect(h.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });
});
