/**
 * V2 スコア計算 API
 * SCORING_V2_ARCHITECTURE.md §4, §8
 * POST /api/v1/matching/compute-v2
 *
 * V1の /matching/compute と並行稼動。
 * user_conversation_vectors を読み、matching_scores_v4 に書く。
 */

import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { computeScoreV2 } from "@/lib/matching/score-compute-v2";
import { generateReasonsV2 } from "@/lib/matching/reason-templates-v2";
import { checkMatchingRateLimit } from "@/lib/rate-limit";
import type { ScoringConfig } from "@/lib/matching/score-compute-v2";

export async function POST() {
  try {
    const { user } = await withAuth();

    // Matching compute rate limit: 5 req per 5 min per user
    const rl = checkMatchingRateLimit(user.id);
    if (!rl.allowed) {
      return jsonError(429, "RATE_LIMITED", "マッチング計算のリクエストが多すぎます。しばらくしてから再試行してください");
    }

    const supabase = await createServiceClient();

    // --- scoring_config 取得 ---
    const { data: configRows } = await supabase
      .from("scoring_config")
      .select("*")
      .eq("is_active", true)
      .limit(1);

    const configRow = configRows?.[0] as { weights_json: unknown; alpha_table_json: unknown; boost_params_json: unknown; version_id: string } | undefined;
    if (!configRow) {
      return json({ error: "No active scoring config" }, 500);
    }

    const config: ScoringConfig = {
      weights_json: configRow.weights_json as ScoringConfig["weights_json"],
      alpha_table_json: configRow.alpha_table_json as ScoringConfig["alpha_table_json"],
      boost_params_json: configRow.boost_params_json as ScoringConfig["boost_params_json"],
    };

    // --- 自分の会話ベクトル取得 ---
    const { data: myVectorsRaw } = await supabase
      .from("user_conversation_vectors")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    const myVectors = myVectorsRaw as { user_id: string; need_vectors: unknown[]; offer_vectors: unknown[]; topic_vectors: unknown[]; engagement_signature: Record<string, number>; analysis_count: number } | null;

    // --- 自分のプロフィール + goals/offerings ---
    const { data: myProfile } = await supabase
      .from("user_profiles")
      .select("id, name, company, position, industry, bio")
      .eq("id", user.id)
      .single();

    const { data: myGoals } = await supabase
      .from("user_goals").select("type").eq("user_id", user.id);
    const { data: myOfferings } = await supabase
      .from("user_offerings").select("type").eq("user_id", user.id);

    // --- 全ターゲット取得 ---
    const { data: targets } = await supabase
      .from("user_profiles")
      .select("id, name, company, position, industry, bio")
      .eq("is_active", true)
      .neq("id", user.id);

    if (!targets?.length) return json({ computed: 0 });

    const targetIds = targets.map((t) => t.id);

    // ターゲットの会話ベクトル一括取得
    const { data: targetVectorsRaw } = await supabase
      .from("user_conversation_vectors")
      .select("*")
      .in("user_id", targetIds);

    type VectorRow = { user_id: string; need_vectors: unknown[]; offer_vectors: unknown[]; topic_vectors: unknown[]; engagement_signature: Record<string, number>; analysis_count: number };
    const vectorMap = new Map<string, VectorRow>(
      ((targetVectorsRaw ?? []) as VectorRow[]).map((v) => [v.user_id, v]),
    );

    // ターゲットの goals/offerings 一括取得
    const { data: allGoals } = await supabase
      .from("user_goals").select("user_id, type").in("user_id", targetIds);
    const { data: allOfferings } = await supabase
      .from("user_offerings").select("user_id, type").in("user_id", targetIds);

    const goalsMap = new Map<string, { type: string }[]>();
    const offeringsMap = new Map<string, { type: string }[]>();
    for (const g of allGoals ?? []) {
      if (!goalsMap.has(g.user_id)) goalsMap.set(g.user_id, []);
      goalsMap.get(g.user_id)!.push({ type: g.type });
    }
    for (const o of allOfferings ?? []) {
      if (!offeringsMap.has(o.user_id)) offeringsMap.set(o.user_id, []);
      offeringsMap.get(o.user_id)!.push({ type: o.type });
    }

    // --- ペアごとにスコア計算 ---
    const rows: Record<string, unknown>[] = [];

    for (const target of targets) {
      const tv = vectorMap.get(target.id);

      // Forward: viewer → target
      const fwd = computeScoreV2({
        viewer: {
          id: user.id,
          industry: myProfile?.industry,
          position: myProfile?.position,
          bio: myProfile?.bio,
          analysisCount: myVectors?.analysis_count ?? 0,
          goals: myGoals ?? [],
          offerings: myOfferings ?? [],
          needVectors: (myVectors?.need_vectors as unknown[]) as import("@/lib/matching/score-compute-v2").NeedVector[] ?? [],
          offerVectors: (myVectors?.offer_vectors as unknown[]) as import("@/lib/matching/score-compute-v2").OfferVector[] ?? [],
          topicVectors: (myVectors?.topic_vectors as unknown[]) as import("@/lib/matching/score-compute-v2").TopicVector[] ?? [],
          engagementSignature: (myVectors?.engagement_signature ?? {}) as import("@/lib/matching/score-compute-v2").EngagementSignature,
        },
        target: {
          id: target.id,
          name: target.name,
          industry: target.industry,
          position: target.position,
          bio: target.bio,
          company: target.company,
          analysisCount: tv?.analysis_count ?? 0,
          goals: goalsMap.get(target.id) ?? [],
          offerings: offeringsMap.get(target.id) ?? [],
          needVectors: (tv?.need_vectors as unknown[] ?? []) as import("@/lib/matching/score-compute-v2").NeedVector[],
          offerVectors: (tv?.offer_vectors as unknown[] ?? []) as import("@/lib/matching/score-compute-v2").OfferVector[],
          topicVectors: (tv?.topic_vectors as unknown[] ?? []) as import("@/lib/matching/score-compute-v2").TopicVector[],
          engagementSignature: (tv?.engagement_signature ?? {}) as import("@/lib/matching/score-compute-v2").EngagementSignature,
        },
        sharedMeetingCount: 0, // TODO: 共有ミーティング数を取得
        config,
      });

      // 理由生成
      const topOffer = (tv?.offer_vectors as { text?: string }[] | null)?.[0];
      const topTopic = (tv?.topic_vectors as { topic?: string }[] | null)?.[0];
      const fwdReasons = generateReasonsV2({
        target: { name: target.name, industry: target.industry, position: target.position, company: target.company },
        ...fwd,
        sharedMeetingCount: 0,
        topOfferText: topOffer?.text,
        topTopicText: topTopic?.topic,
      });

      rows.push({
        viewer_id: user.id,
        target_id: target.id,
        need_offer_score: fwd.needOfferScore,
        reverse_match: fwd.reverseMatch,
        expertise_fit: fwd.expertiseFit,
        topic_alignment: fwd.topicAlignment,
        engagement_value: fwd.engagementValue,
        history_score: fwd.historyScore,
        total_score: fwd.totalScore,
        confidence: fwd.confidence,
        phase: fwd.phase,
        score_reasons: fwdReasons,
        notify_tier: fwd.notifyTier,
        is_stale: false,
        config_version: configRow.version_id,
        algorithm_version: "v2.0",
        calculated_at: new Date().toISOString(),
      });

      // Reverse: target → viewer
      const rev = computeScoreV2({
        viewer: {
          id: target.id,
          industry: target.industry,
          position: target.position,
          bio: target.bio,
          analysisCount: tv?.analysis_count ?? 0,
          goals: goalsMap.get(target.id) ?? [],
          offerings: offeringsMap.get(target.id) ?? [],
          needVectors: (tv?.need_vectors as unknown[] ?? []) as import("@/lib/matching/score-compute-v2").NeedVector[],
          offerVectors: (tv?.offer_vectors as unknown[] ?? []) as import("@/lib/matching/score-compute-v2").OfferVector[],
          topicVectors: (tv?.topic_vectors as unknown[] ?? []) as import("@/lib/matching/score-compute-v2").TopicVector[],
          engagementSignature: (tv?.engagement_signature ?? {}) as import("@/lib/matching/score-compute-v2").EngagementSignature,
        },
        target: {
          id: user.id,
          name: myProfile?.name,
          industry: myProfile?.industry,
          position: myProfile?.position,
          bio: myProfile?.bio,
          company: myProfile?.company,
          analysisCount: myVectors?.analysis_count ?? 0,
          goals: myGoals ?? [],
          offerings: myOfferings ?? [],
          needVectors: (myVectors?.need_vectors as unknown[]) as import("@/lib/matching/score-compute-v2").NeedVector[] ?? [],
          offerVectors: (myVectors?.offer_vectors as unknown[]) as import("@/lib/matching/score-compute-v2").OfferVector[] ?? [],
          topicVectors: (myVectors?.topic_vectors as unknown[]) as import("@/lib/matching/score-compute-v2").TopicVector[] ?? [],
          engagementSignature: (myVectors?.engagement_signature ?? {}) as import("@/lib/matching/score-compute-v2").EngagementSignature,
        },
        sharedMeetingCount: 0,
        config,
      });

      const myTopOffer = (myVectors?.offer_vectors as { text?: string }[] | null)?.[0];
      const myTopTopic = (myVectors?.topic_vectors as { topic?: string }[] | null)?.[0];
      const revReasons = generateReasonsV2({
        target: { name: myProfile?.name, industry: myProfile?.industry, position: myProfile?.position, company: myProfile?.company },
        ...rev,
        sharedMeetingCount: 0,
        topOfferText: myTopOffer?.text,
        topTopicText: myTopTopic?.topic,
      });

      rows.push({
        viewer_id: target.id,
        target_id: user.id,
        need_offer_score: rev.needOfferScore,
        reverse_match: rev.reverseMatch,
        expertise_fit: rev.expertiseFit,
        topic_alignment: rev.topicAlignment,
        engagement_value: rev.engagementValue,
        history_score: rev.historyScore,
        total_score: rev.totalScore,
        confidence: rev.confidence,
        phase: rev.phase,
        score_reasons: revReasons,
        notify_tier: rev.notifyTier,
        is_stale: false,
        config_version: configRow.version_id,
        algorithm_version: "v2.0",
        calculated_at: new Date().toISOString(),
      });
    }

    // --- バッチ UPSERT (50件ずつ) ---
    let computed = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("matching_scores_v4")
        .upsert(batch, { onConflict: "viewer_id,target_id" });

      if (error) {
        console.error("V2 score upsert error:", error.message);
      } else {
        computed += batch.length;
      }
    }

    return json({ computed, config_version: configRow.version_id });
  } catch (error) {
    return handleApiError(error);
  }
}
