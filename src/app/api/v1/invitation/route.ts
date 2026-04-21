import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

/**
 * POST /api/v1/invitation — 招待コード検証
 * 登録前に招待コードの有効性を確認する（認証不要）
 */
export async function POST(request: Request) {
  try {
    // Auth endpoint rate limit: 10 req/min per IP
    const headersList = await headers();
    const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = checkAuthRateLimit(ip);
    if (!rl.allowed) {
      return jsonError(429, "RATE_LIMITED", "リクエストが多すぎます。しばらくしてから再試行してください");
    }

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

/**
 * PATCH /api/v1/invitation — 招待コード使用回数インクリメント
 * 登録成功後にクライアントから呼ばれる
 */
export async function PATCH(request: Request) {
  try {
    const headersList = await headers();
    const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = checkAuthRateLimit(ip);
    if (!rl.allowed) {
      return jsonError(429, "RATE_LIMITED", "リクエストが多すぎます。しばらくしてから再試行してください");
    }

    const body = await request.json().catch(() => null);
    if (!body?.invitation_id || typeof body.invitation_id !== "string") {
      return jsonError(400, "BAD_REQUEST", "invitation_id が必要です");
    }

    const supabase = await createClient();

    // Read current use_count then increment
    const { data: invitation, error: fetchError } = await supabase
      .from("invitation_codes")
      .select("id, use_count")
      .eq("id", body.invitation_id)
      .single();

    if (fetchError || !invitation) {
      return jsonError(404, "NOT_FOUND", "招待コードが見つかりません");
    }

    const { error: updateError } = await supabase
      .from("invitation_codes")
      .update({ use_count: invitation.use_count + 1 })
      .eq("id", body.invitation_id);

    if (updateError) {
      return jsonError(500, "UPDATE_FAILED", "使用回数の更新に失敗しました");
    }

    return json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
