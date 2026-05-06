/**
 * GET /api/v1/calendar/connect?provider=google
 *
 * OAuth 開始: 同意確認 → state 署名 → Google authorize URL に 302 redirect。
 *
 * Phase B-2:
 *   - state HMAC 署名で CSRF 防止
 *   - 個情法28条 / 電通事業法27条12 同意 (google_us_transfer_v1) を確認
 *     未同意なら 403、同意 UI へ誘導
 */

import { NextResponse } from "next/server";
import {
  withAuth,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { signOAuthState } from "@/lib/calendar/oauth-state";
import { buildAuthUrl } from "@/lib/calendar/google";

const STATE_TTL_SEC = 300; // 5 分

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");

    if (provider !== "google") {
      return jsonError(400, "BAD_REQUEST", "provider は google のみ対応");
    }

    // 同意ログ確認: google_us_transfer_v1 (個情法28条 / 電通事業法27条12)
    const { data: consent } = await supabase
      .from("meeting_consents")
      .select("id, revoked_at")
      .eq("user_id", user.id)
      .eq("scope", "google_us_transfer_v1")
      .is("revoked_at", null)
      .maybeSingle();
    if (!consent) {
      return jsonError(
        403,
        "CONSENT_REQUIRED",
        "Google 連携には越境送信同意が必要です",
      );
    }

    const state = await signOAuthState({
      user_id: user.id,
      provider: "google",
      nonce: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
    });

    return NextResponse.redirect(buildAuthUrl(state), { status: 302 });
  } catch (error) {
    return handleApiError(error);
  }
}
