import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";

const VALID_VALUE_TAGS = ["アドバイス", "紹介", "気づき", "共通課題", "なし"] as const;

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data, error } = await supabase
      .from("feedback_log")
      .select("target_id")
      .eq("viewer_id", user.id);

    if (error) throw error;

    return json(data ?? []);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await withAuth(request);
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "リクエストボディが不正です");
    }

    const { target_id, rating, value_tags } = body;

    // Validate target_id
    if (!target_id || !isValidUUID(target_id)) {
      return jsonError(400, "BAD_REQUEST", "有効なユーザーIDが必要です");
    }

    if (target_id === user.id) {
      return jsonError(400, "BAD_REQUEST", "自分自身を評価できません");
    }

    // Validate rating
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonError(400, "BAD_REQUEST", "評価は1〜5の整数で指定してください");
    }

    // Validate value_tags
    if (value_tags !== undefined) {
      if (!Array.isArray(value_tags) || value_tags.some((t: unknown) => typeof t !== "string" || !VALID_VALUE_TAGS.includes(t as typeof VALID_VALUE_TAGS[number]))) {
        return jsonError(400, "BAD_REQUEST", "無効な価値タグが含まれています");
      }
    }

    const serviceClient = await createServiceClient();

    // Look up current matching_scores_v4 for this pair
    const { data: score } = await serviceClient
      .from("matching_scores_v4")
      .select("need_offer_score, reverse_match, config_version")
      .eq("viewer_id", user.id)
      .eq("target_id", target_id)
      .maybeSingle();

    // Insert into feedback_log
    const { data, error } = await serviceClient
      .from("feedback_log")
      .insert({
        viewer_id: user.id,
        target_id,
        rating,
        value_tags: value_tags ?? [],
        haiku_no_at_time: score?.need_offer_score ?? null,
        haiku_rv_at_time: score?.reverse_match ?? null,
        config_version: score?.config_version ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return json(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
