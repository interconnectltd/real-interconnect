import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/v1/invitation — 招待コード検証
 * 登録前に招待コードの有効性を確認する（認証不要）
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.code || typeof body.code !== "string") {
      return jsonError(400, "BAD_REQUEST", "招待コードを入力してください");
    }

    const code = body.code.trim().toUpperCase();
    const supabase = await createClient();

    const { data: invitation } = await supabase
      .from("invitation_codes")
      .select("id, code, max_uses, use_count, expires_at, is_active")
      .eq("code", code)
      .eq("is_active", true)
      .maybeSingle();

    if (!invitation) {
      return jsonError(404, "INVALID_CODE", "この招待コードは無効です");
    }

    if (invitation.use_count >= invitation.max_uses) {
      return jsonError(410, "CODE_EXHAUSTED", "この招待コードは使用上限に達しました");
    }

    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return jsonError(410, "CODE_EXPIRED", "この招待コードは期限切れです");
    }

    return json({ valid: true, invitation_id: invitation.id });
  } catch (error) {
    return handleApiError(error);
  }
}
