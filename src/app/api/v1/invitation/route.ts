import { headers } from "next/headers";
import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/client-ip";
import { enforceAnonRateLimit } from "@/lib/rate-limit-db";

/**
 * POST /api/v1/invitation — 招待コード validate (anon)
 *
 * Wave1 sec audit (2026-05-07) 修正版:
 *   - service_role での直 SELECT を SECURITY DEFINER RPC `validate_invitation_code` に置換
 *     (RLS bypass / code enumeration leak 抑止)
 *   - レスポンスに invitation_id / max_uses / expires_at は **載せない** (情報漏えい防止)
 *   - DB-backed rate limit (IP 軸) で multi-instance も effective
 *   - 旧 PATCH (use_count++ ; IDOR) は廃止。代わりに handle_new_user trigger で atomic 消費
 */
export async function POST(request: Request) {
  try {
    const h = await headers();
    const ip = getClientIp(h);

    const body = await request.json().catch(() => null);
    if (!body?.code || typeof body.code !== "string") {
      return jsonError(400, "BAD_REQUEST", "招待コードを入力してください");
    }

    const code = body.code.trim();
    if (code.length === 0 || code.length > 64) {
      return jsonError(400, "BAD_REQUEST", "招待コード形式が不正です");
    }

    // IP 軸 (10/min) と code 軸 (10/h) の双方で rate-limit。
    // IP は IPv6 ローテーションで bypass 可能なので code 単位 RL を併用 (Wave1 audit R-2)。
    const codeKey = code.toUpperCase();
    const [okIp, okCode] = await Promise.all([
      enforceAnonRateLimit({
        bucket: "invitation:ip",
        identifier: ip ?? "unknown",
        limit: 10,
        windowSec: 60,
        strict: true,
      }),
      enforceAnonRateLimit({
        bucket: "invitation:code",
        identifier: codeKey,
        limit: 10,
        windowSec: 3600,
        strict: false,
      }),
    ]);
    if (!okIp || !okCode) {
      return jsonError(
        429,
        "RATE_LIMITED",
        "リクエストが多すぎます。しばらくしてから再試行してください",
      );
    }

    const supabase = await createServiceClient();
    type LooseRpc = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: boolean | null; error: { message?: string } | null }>;
    };
    const { data: valid, error } = await (supabase as unknown as LooseRpc).rpc(
      "validate_invitation_code",
      { p_code: code },
    );
    if (error) {
      return jsonError(500, "VALIDATION_FAILED", "招待コードの検証に失敗しました");
    }
    if (valid !== true) {
      // INVALID / EXHAUSTED / EXPIRED を区別せず一律 404 (enumeration 防止)
      return jsonError(404, "INVALID_CODE", "この招待コードは無効です");
    }
    return json({ valid: true });
  } catch (error) {
    return handleApiError(error);
  }
}
