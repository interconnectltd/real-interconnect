/**
 * src/lib/calendar/encryption.ts
 *
 * Calendar OAuth token を AES-256-GCM で暗号化保管。
 * R3 Phase B Sec: 「token 平文は即 NG、Vault or pgcrypto + KMS」指摘の対応。
 *
 * 環境変数 CALENDAR_TOKEN_ENC_KEY (32B base64 = 44 chars) を Master Key として使用。
 *
 * Format:
 *   storage = base64( iv(12B) || ciphertext || authTag(16B) )
 */

const ENC_KEY_ENV = "CALENDAR_TOKEN_ENC_KEY";
const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

let cachedKey: CryptoKey | null = null;

async function loadKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const b64 = process.env[ENC_KEY_ENV];
  if (!b64) {
    throw new Error(`${ENC_KEY_ENV} env not set (32-byte base64 required)`);
  }
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) {
    throw new Error(`${ENC_KEY_ENV} must decode to 32 bytes (got ${raw.length})`);
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptToken(plain: string): Promise<string> {
  if (!plain) return "";
  const key = await loadKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const enc = new TextEncoder().encode(plain);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    enc,
  );
  const cipher = new Uint8Array(cipherBuf);
  // iv (12) + ciphertext + authTag(16) を連結
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return bytesToBase64(combined);
}

export async function decryptToken(b64: string): Promise<string> {
  if (!b64) return "";
  const key = await loadKey();
  const combined = base64ToBytes(b64);
  if (combined.length < IV_LENGTH + 16) {
    throw new Error("encrypted token too short");
  }
  const iv = combined.slice(0, IV_LENGTH);
  const cipher = combined.slice(IV_LENGTH);
  const plainBuf = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    cipher,
  );
  return new TextDecoder().decode(plainBuf);
}
