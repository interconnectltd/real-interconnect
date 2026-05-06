/**
 * src/lib/calendar/access-token.ts
 *
 * calendar_connections から復号 access_token を取得し、
 * 期限切れなら refresh_token で更新して保存。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { decryptToken, encryptToken } from "./encryption";
import { refreshAccessToken } from "./google";

const REFRESH_BUFFER_SEC = 60; // 期限 60 秒前で refresh

export async function getValidGoogleAccessToken(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ accessToken: string; providerEmail: string } | null> {
  // service_role 必須 (token 列が REVOKE された authenticated 経路では SELECT できない)
  const { data: conn } = await supabase
    .from("calendar_connections")
    .select(
      "id, provider_email, access_token_enc, refresh_token_enc, token_expires_at, is_active",
    )
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("is_active", true)
    .maybeSingle();
  if (!conn || !conn.access_token_enc) return null;

  const expiresAt = conn.token_expires_at
    ? new Date(conn.token_expires_at).getTime()
    : 0;
  const now = Date.now();

  // 期限内ならそのまま返す
  if (expiresAt - now > REFRESH_BUFFER_SEC * 1000) {
    return {
      accessToken: await decryptToken(conn.access_token_enc),
      providerEmail: conn.provider_email,
    };
  }

  // refresh
  if (!conn.refresh_token_enc) return null;
  const refreshTok = await decryptToken(conn.refresh_token_enc);
  const fresh = await refreshAccessToken(refreshTok);
  const newAccess = fresh.access_token;
  const newAccessEnc = await encryptToken(newAccess);
  const newExpires = new Date(Date.now() + fresh.expires_in * 1000).toISOString();

  // refresh_token は再発行されない場合があるので存在時のみ更新
  const newRefreshEnc = fresh.refresh_token
    ? await encryptToken(fresh.refresh_token)
    : conn.refresh_token_enc;

  await supabase
    .from("calendar_connections")
    .update({
      access_token_enc: newAccessEnc,
      refresh_token_enc: newRefreshEnc,
      token_expires_at: newExpires,
    })
    .eq("id", conn.id);

  return { accessToken: newAccess, providerEmail: conn.provider_email };
}
