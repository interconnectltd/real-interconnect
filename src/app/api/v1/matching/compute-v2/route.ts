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
import { applyEmbeddingScoreBatch } from "@/lib/matching/embedding";
import type { ScoringConfig } from "@/lib/matching/score-compute-v2";
import type { JudgeCacheRow } from "@/lib/matching/judge-haiku";
import type { Database } from "@/types/database";

/** Haiku reasons を attribute reasons の前に追加 (重複は除去、最大 5 件) */
function mergeUnique(haiku: string[], attr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of [...haiku, ...attr]) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
    if (out.length >= 5) break;
  }
  return out;
}

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
      return jsonError(500, "CONFIG_ERROR", "スコアリング設定が見つかりません");
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

    // --- judge_pair_cache 一括取得 (viewer × target_ids 双方向) ---
    // Haiku 4-text crossmatch の結果を applyHaikuJudgment が読む。
    // 双方向 row を一度に集めるため (viewer_id, target_id) 双方向クエリ。
    type JudgeRowDb = JudgeCacheRow & { viewer_id: string; target_id: string };
    const { data: judgeCacheRaw } = await (
      supabase.from("judge_pair_cache" as never) as unknown as {
        select: (s: string) => {
          or: (cond: string) => Promise<{ data: JudgeRowDb[] | null }>;
        };
      }
    )
      .select("viewer_id, target_id, need_idx, offer_idx, h_no, h_rv, reason_no, reason_rv")
      .or(
        `and(viewer_id.eq.${user.id}),and(target_id.eq.${user.id})`,
      );
    const judgeCacheByPair = new Map<string, JudgeCacheRow[]>();
    for (const row of judgeCacheRaw ?? []) {
      const key = `${row.viewer_id}::${row.target_id}`;
      if (!judgeCacheByPair.has(key)) judgeCacheByPair.set(key, []);
      judgeCacheByPair.get(key)!.push({
        need_idx: row.need_idx,
        offer_idx: row.offer_idx,
        h_no: row.h_no,
        h_rv: row.h_rv,
        reason_no: row.reason_no,
        reason_rv: row.reason_rv,
      });
    }

    // --- 意味空間スコアを 1 RTT バッチ取得 (P4 指摘 #1 N-RTT 暴発の修正) ---
    // 旧: Promise.all で N RPC = 1k ユーザーで 8-15s。
    // 新: match_pair_embeddings_batch で全 target を 1 RPC、p95 ~250ms。
    const embeddingByTarget = await applyEmbeddingScoreBatch(user.id, targetIds, supabase);

    // --- 共有ミーティング数を取得 ---
    const { data: viewerParticipations } = await supabase
      .from("meeting_participants_v2")
      .select("meeting_id")
      .eq("user_id", user.id);

    const viewerMeetingIds = (viewerParticipations ?? []).map((p) => p.meeting_id);

    const sharedMeetingMap = new Map<string, number>();
    if (viewerMeetingIds.length > 0) {
      const { data: targetParticipations } = await supabase
        .from("meeting_participants_v2")
        .select("user_id, meeting_id")
        .in("user_id", targetIds)
        .in("meeting_id", viewerMeetingIds);

      for (const tp of targetParticipations ?? []) {
        sharedMeetingMap.set(tp.user_id, (sharedMeetingMap.get(tp.user_id) ?? 0) + 1);
      }
    }

    // --- ペアごとにスコア計算 ---
    type ScoreRow = Database["public"]["Tables"]["matching_scores_v4"]["Insert"];
    const rows: ScoreRow[] = [];

    for (const target of targets) {
      const tv = vectorMap.get(target.id);
      const fwdJudge = judgeCacheByPair.get(`${user.id}::${target.id}`) ?? [];
      const revJudge = judgeCacheByPair.get(`${target.id}::${user.id}`) ?? [];
      const fwdEmb = embeddingByTarget.get(target.id) ?? { semanticNo: 0, semanticRv: 0, semanticTopic: 0 };
      // 逆方向は viewer/target 入替なので semanticNo/Rv が flip
      const revEmb = { semanticNo: fwdEmb.semanticRv, semanticRv: fwdEmb.semanticNo, semanticTopic: fwdEmb.semanticTopic };

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
        sharedMeetingCount: sharedMeetingMap.get(target.id) ?? 0,
        config,
        judgeCacheRows: fwdJudge,
        embeddingScores: fwdEmb,
      });

      // 理由生成
      const topOffer = (tv?.offer_vectors as { text?: string }[] | null)?.[0];
      const topTopic = (tv?.topic_vectors as { topic?: string }[] | null)?.[0];
      const sharedCount = sharedMeetingMap.get(target.id) ?? 0;
      const fwdReasonsBase = generateReasonsV2({
        target: { name: target.name, industry: target.industry, position: target.position, company: target.company },
        ...fwd,
        sharedMeetingCount: sharedCount,
        topOfferText: topOffer?.text,
        topTopicText: topTopic?.topic,
      });
      // P5 指摘 #1: Haiku 由来の reason を最優先で先頭に挿入 (重複は除去)
      const fwdReasons = mergeUnique(fwd.reasons, fwdReasonsBase);

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
        sharedMeetingCount: sharedCount,
        config,
        judgeCacheRows: revJudge,
        embeddingScores: revEmb,
      });

      const myTopOffer = (myVectors?.offer_vectors as { text?: string }[] | null)?.[0];
      const myTopTopic = (myVectors?.topic_vectors as { topic?: string }[] | null)?.[0];
      const revReasonsBase = generateReasonsV2({
        target: { name: myProfile?.name, industry: myProfile?.industry, position: myProfile?.position, company: myProfile?.company },
        ...rev,
        sharedMeetingCount: sharedCount,
        topOfferText: myTopOffer?.text,
        topTopicText: myTopTopic?.topic,
      });
      const revReasons = mergeUnique(rev.reasons, revReasonsBase);

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
      const { error } = await supabase
        .from("matching_scores_v4")
        .upsert(batch, { onConflict: "viewer_id,target_id" });

      if (error) {
        console.error("V2 score upsert error:", error.message);
      } else {
        computed += batch.length;
      }
    }

    // --- Haiku 判定バッチ enqueue (SCORING_V2_ARCHITECTURE.md §3.4 — top-50 リランキング) ---
    // viewer 視点のスコア上位 N 件を judge_pair_batch ジョブとしてキューに投入。
    // 結果は judge_pair_cache に書かれ、次回の compute-v2 で applyHaikuJudgment が読み込む。
    const TOP_N_FOR_JUDGE = 50;
    let enqueuedJudge = false;
    try {
      const viewerRows = rows
        .filter((r) => r.viewer_id === user.id)
        .sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))
        .slice(0, TOP_N_FOR_JUDGE);
      const candidateTargetIds = viewerRows.map((r) => r.target_id);

      if (candidateTargetIds.length > 0) {
        // 既存の analyze/aggregate と同じ enqueueJob 規約 (重複防止: 同じ payload は再投入しない)
        const payload = { viewer_id: user.id, target_ids: candidateTargetIds, top_n: TOP_N_FOR_JUDGE };
        const payloadStr = JSON.stringify(payload);

        const { data: existing } = await supabase
          .from("job_queue")
          .select("id")
          .eq("type", "judge_pair_batch")
          .in("status", ["pending", "running"])
          .eq("payload", payloadStr)
          .limit(1);

        if (!existing?.length) {
          await supabase.from("job_queue").insert({
            type: "judge_pair_batch",
            payload,
            priority: 2,
            status: "pending",
          });
          enqueuedJudge = true;
        }
      }
    } catch (e) {
      // judge enqueue 失敗はスコア計算自体の成功を阻害しない
      console.error("judge_pair_batch enqueue failed:", e instanceof Error ? e.message : String(e));
    }

    return json({ computed, config_version: configRow.version_id, enqueued_judge: enqueuedJudge });
  } catch (error) {
    return handleApiError(error);
  }
}
