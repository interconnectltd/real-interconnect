/**
 * GET /api/v1/calendar/oauth/callback?code=...&state=...
 *
 * OAuth callback: state 検証 → code 交換 → token 暗号化保管 → 設定画面に戻る。
 */

import { NextResponse } from "next/server";
import {
  withAuth,
  handleApiError,
} from "@/lib/api-helpers";
import { verifyOAuthState } from "@/lib/calendar/oauth-state";
import { exchangeCode, fetchUserInfo } from "@/lib/calendar/google";
import { encryptToken } from "@/lib/calendar/encryption";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

const SETTINGS_PATH = "/settings/calendar"; // user-facing redirect target

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");

    if (errParam) {
      return redirectWithMsg(SETTINGS_PATH, "error", errParam);
    }
    if (!code || !state) {
      return redirectWithMsg(SETTINGS_PATH, "error", "missing_params");
    }

    // 1. state 検証
    const payload = await verifyOAuthState(state);
    if (!payload) {
      return redirectWithMsg(SETTINGS_PATH, "error", "invalid_state");
    }
    if (payload.user_id !== user.id) {
      return redirectWithMsg(SETTINGS_PATH, "error", "user_mismatch");
    }

    // 2. code 交換
    const tok = await exchangeCode(code);
    if (!tok.refresh_token) {
      // refresh_token が来ないのはスコープ未承認 or prompt=consent 不足
      return redirectWithMsg(
        SETTINGS_PATH,
        "error",
        "no_refresh_token_re_consent_required",
      );
    }

    // 3. provider_email 取得
    const userInfo = await fetchUserInfo(tok.access_token);

    // 4. token 暗号化
    const accessEnc = await encryptToken(tok.access_token);
    const refreshEnc = await encryptToken(tok.refresh_token);
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();

    // 5. calendar_connections upsert
    const { error: upErr } = await supabase
      .from("calendar_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "google",
          provider_email: userInfo.email,
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc,
          token_expires_at: expiresAt,
          is_active: true,
        },
        { onConflict: "user_id,provider" },
      );
    if (upErr) {
      return redirectWithMsg(SETTINGS_PATH, "error", "db_save_failed");
    }

    // 6. audit-log
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "calendar.connect",
      target_type: "calendar_connection",
      target_id: null,
      payload: { provider: "google", provider_email: userInfo.email },
      ip: client.ip,
      ua: client.ua,
    });

    return redirectWithMsg(SETTINGS_PATH, "success", "google_connected");
  } catch (error) {
    return handleApiError(error);
  }
}

function redirectWithMsg(
  path: string,
  kind: "success" | "error",
  msg: string,
): NextResponse {
  const target = new URL(path, "https://inter-connect.app");
  target.searchParams.set(kind, msg);
  return NextResponse.redirect(target.toString(), { status: 302 });
}
