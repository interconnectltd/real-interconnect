/**
 * GET /api/v1/matching/pair/[targetId]
 *
 * 自分 (user.id) と target (params.targetId) の双方向マッチング分析を返す。
 *   - my_score / their_score: 双方向 score (matching_scores_v4)
 *   - is_mutual: 双方が threshold 以上か
 *   - my_reasons / their_reasons: AI が生成した理由文
 *   - common_topics: 双方の goals/offerings 重複
 *   - needs_compute: 自分→相手の score 未計算
 *   - their_missing: 相手→自分の score 未計算
 *
 * SECURITY DEFINER RPC `get_pair_matching` を呼ぶ事で
 *   1) RLS を超えて他人の goals/offerings 集合だけ取得 (detail は隠蔽)
 *   2) 1 RTT で完結 (旧版は 7 query)
 *   3) auth.uid() 検証は RPC 内
 * を実現している (migration 00019)。
 */

import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { MATCHING_MUTUAL_THRESHOLD } from "@/lib/constants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PairMatchingRpcResult {
  target_profile: {
    id: string;
    name: string;
    company: string | null;
    position: string | null;
    industry: string | null;
    bio: string | null;
    avatar_url: string | null;
  } | null;
  my_score: number;
  their_score: number;
  is_mutual: boolean;
  my_reasons: string[] | null;
  their_reasons: string[] | null;
  my_confidence: number | null;
  phase: string | null;
  common_topics: {
    my_want_they_have: string[] | null;
    i_offer_they_want: string[] | null;
  };
  needs_compute: boolean;
  their_missing: boolean;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ targetId: string }> },
) {
  try {
    const { user, supabase } = await withAuth();
    const { targetId } = await context.params;

    if (!targetId || !UUID_RE.test(targetId)) {
      return jsonError(400, "BAD_REQUEST", "対象ユーザーが不正です");
    }
    if (targetId === user.id) {
      return jsonError(400, "BAD_REQUEST", "自分自身は分析できません");
    }

    // 型再生成前なので any 経由で呼ぶ。migration 00019 で生成済み
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>
    )("get_pair_matching", { p_target_id: targetId });

    if (error) {
      return jsonError(500, "RPC_FAILED", error.message);
    }

    const r = data as PairMatchingRpcResult | null;
    if (!r || !r.target_profile) {
      // RPC は退会/非アクティブ時 target_profile=null を返す
      return jsonError(404, "NOT_FOUND", "ユーザーが見つかりません");
    }

    return json({
      target_profile: r.target_profile,
      my_score: r.my_score ?? 0,
      their_score: r.their_score ?? 0,
      is_mutual:
        (r.my_score ?? 0) >= MATCHING_MUTUAL_THRESHOLD &&
        (r.their_score ?? 0) >= MATCHING_MUTUAL_THRESHOLD,
      my_reasons: r.my_reasons ?? [],
      their_reasons: r.their_reasons ?? [],
      my_confidence: r.my_confidence ?? null,
      phase: r.phase ?? "attribute_only",
      common_topics: {
        my_want_they_have: r.common_topics?.my_want_they_have ?? [],
        i_offer_they_want: r.common_topics?.i_offer_they_want ?? [],
      },
      needs_compute: r.needs_compute ?? false,
      their_missing: r.their_missing ?? false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
