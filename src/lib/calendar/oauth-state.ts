/**
 * src/lib/calendar/oauth-state.ts
 *
 * OAuth state パラメータの HMAC 署名 (CSRF + state tampering 防止)。
 * R3 Phase B 準備度レビューの指摘:
 *   「state パラメータ署名 (HMAC) で CSRF 対策」
 *
 * Format:
 *   state = base64url( payload_json ) + "." + base64url( hmac_sha256 )
 */

const SECRET_ENV = "OAUTH_STATE_SECRET";

function b64url(input: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < input.length; i++) bin += String.fromCharCode(input[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

let cachedKey: CryptoKey | null = null;
async function loadKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = process.env[SECRET_ENV];
  if (!secret) {
    throw new Error(`${SECRET_ENV} env not set`);
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

export interface OAuthStatePayload {
  user_id: string;
  provider: "google";
  nonce: string;            // crypto.randomUUID()
  exp: number;              // Unix seconds
}

export async function signOAuthState(payload: OAuthStatePayload): Promise<string> {
  const key = await loadKey();
  const json = JSON.stringify(payload);
  const enc = new TextEncoder().encode(json);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "HMAC" }, key, enc),
  );
  return `${b64url(enc)}.${b64url(sig)}`;
}

export async function verifyOAuthState(
  state: string,
): Promise<OAuthStatePayload | null> {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  if (!payloadPart || !sigPart) return null;

  const key = await loadKey();
  const payloadBytes = b64urlDecode(payloadPart);
  const sigBytes = b64urlDecode(sigPart);

  const ok = await crypto.subtle.verify(
    { name: "HMAC" },
    key,
    sigBytes as BufferSource,
    payloadBytes as BufferSource,
  );
  if (!ok) return null;

  let parsed: OAuthStatePayload;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  // 有効期限チェック
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof parsed.exp !== "number" || parsed.exp < nowSec) return null;
  return parsed;
}
