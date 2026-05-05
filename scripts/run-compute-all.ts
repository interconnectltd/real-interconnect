/**
 * 全 active user × 他全員で matching_scores_v4 を再計算する。
 * compute-v2 route と同等のロジックを service_role で叩き、
 * 認証不要でローカル / CI から一括実行可能にする。
 *
 * 実行:
 *   npx tsx scripts/run-compute-all.ts
 *
 * 必要 env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { existsSync } from "fs";
import { resolve } from "path";

const envLocalPath = resolve(process.cwd(), ".env.local");

async function main() {
  if (existsSync(envLocalPath)) {
    const { config } = await import("dotenv");
    config({ path: envLocalPath });
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !srk) throw new Error("Missing Supabase env");

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, srk);

  const { computeScoreV2 } = await import("../src/lib/matching/score-compute-v2");
  const { generateReasonsV2 } = await import("../src/lib/matching/reason-templates-v2");
  const { applyEmbeddingScoreBatch } = await import("../src/lib/matching/embedding");
  type ScoringConfig = import("../src/lib/matching/score-compute-v2").ScoringConfig;
  type NeedVector = import("../src/lib/matching/score-compute-v2").NeedVector;
  type OfferVector = import("../src/lib/matching/score-compute-v2").OfferVector;
  type TopicVector = import("../src/lib/matching/score-compute-v2").TopicVector;
  type EngagementSignature = import("../src/lib/matching/score-compute-v2").EngagementSignature;
  type JudgeCacheRow = import("../src/lib/matching/judge-haiku").JudgeCacheRow;

  // scoring_config
  const { data: cfgRows } = await sb.from("scoring_config").select("*").eq("is_active", true).limit(1);
  const cfgRow = (cfgRows as { weights_json: unknown; alpha_table_json: unknown; boost_params_json: unknown; version_id: string }[] | null)?.[0];
  if (!cfgRow) throw new Error("No active scoring_config");
  const config: ScoringConfig = {
    weights_json: cfgRow.weights_json as ScoringConfig["weights_json"],
    alpha_table_json: cfgRow.alpha_table_json as ScoringConfig["alpha_table_json"],
    boost_params_json: cfgRow.boost_params_json as ScoringConfig["boost_params_json"],
  };

  // 全 active user
  const { data: profiles } = await sb
    .from("user_profiles")
    .select("id, name, company, position, industry, bio")
    .eq("is_active", true);
  const allProfiles = (profiles ?? []) as Array<{ id: string; name: string | null; company: string | null; position: string | null; industry: string | null; bio: string | null }>;

  // user_conversation_vectors 一括
  const { data: vecsRaw } = await sb.from("user_conversation_vectors").select("*");
  type VecRow = { user_id: string; need_vectors: unknown[]; offer_vectors: unknown[]; topic_vectors: unknown[]; engagement_signature: Record<string, number>; analysis_count: number };
  const vecs = new Map<string, VecRow>();
  for (const v of (vecsRaw ?? []) as VecRow[]) vecs.set(v.user_id, v);

  // goals / offerings
  const { data: gAll } = await sb.from("user_goals").select("user_id, type");
  const { data: oAll } = await sb.from("user_offerings").select("user_id, type");
  const goalsMap = new Map<string, { type: string }[]>();
  const offersMap = new Map<string, { type: string }[]>();
  for (const g of (gAll ?? []) as { user_id: string; type: string }[]) {
    if (!goalsMap.has(g.user_id)) goalsMap.set(g.user_id, []);
    goalsMap.get(g.user_id)!.push({ type: g.type });
  }
  for (const o of (oAll ?? []) as { user_id: string; type: string }[]) {
    if (!offersMap.has(o.user_id)) offersMap.set(o.user_id, []);
    offersMap.get(o.user_id)!.push({ type: o.type });
  }

  // judge_pair_cache 全件
  const { data: judgeRaw } = await sb.from("judge_pair_cache").select("viewer_id, target_id, direction, need_idx, offer_idx, h_no, h_rv, reason_no, reason_rv");
  const judgeFwd = new Map<string, JudgeCacheRow[]>();
  const judgeRev = new Map<string, JudgeCacheRow[]>();
  for (const r of (judgeRaw ?? []) as Array<JudgeCacheRow & { viewer_id: string; target_id: string; direction: string }>) {
    const key = `${r.viewer_id}::${r.target_id}`;
    const m = r.direction === "rev" ? judgeRev : judgeFwd;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push({ need_idx: r.need_idx, offer_idx: r.offer_idx, h_no: r.h_no, h_rv: r.h_rv, reason_no: r.reason_no, reason_rv: r.reason_rv });
  }

  // shared meeting (空でも OK)
  const { data: mpAll } = await sb.from("meeting_participants_v2").select("user_id, meeting_id");
  const userMeetings = new Map<string, Set<string>>();
  for (const mp of (mpAll ?? []) as { user_id: string; meeting_id: string }[]) {
    if (!userMeetings.has(mp.user_id)) userMeetings.set(mp.user_id, new Set());
    userMeetings.get(mp.user_id)!.add(mp.meeting_id);
  }

  type ScoreRow = {
    viewer_id: string; target_id: string;
    need_offer_score: number; reverse_match: number;
    expertise_fit: number; topic_alignment: number;
    engagement_value: number; history_score: number;
    total_score: number; confidence: number;
    phase: string; score_reasons: string[]; notify_tier: string | null;
    is_stale: boolean; config_version: string; algorithm_version: string;
    calculated_at: string;
  };
  const rows: ScoreRow[] = [];

  for (const viewer of allProfiles) {
    const targetIds = allProfiles.filter((t) => t.id !== viewer.id).map((t) => t.id);
    const embByTarget = await applyEmbeddingScoreBatch(viewer.id, targetIds, sb as never);

    const vv = vecs.get(viewer.id);
    for (const target of allProfiles) {
      if (target.id === viewer.id) continue;
      const tv = vecs.get(target.id);
      const fwdJ = judgeFwd.get(`${viewer.id}::${target.id}`) ?? [];
      const revJ = judgeRev.get(`${viewer.id}::${target.id}`) ?? [];
      const emb = embByTarget.get(target.id) ?? { semanticNo: 0, semanticRv: 0, semanticTopic: 0 };

      const sharedSet = userMeetings.get(viewer.id);
      const targetSet = userMeetings.get(target.id);
      let shared = 0;
      if (sharedSet && targetSet) for (const m of sharedSet) if (targetSet.has(m)) shared++;

      const result = computeScoreV2({
        viewer: {
          id: viewer.id, industry: viewer.industry, position: viewer.position, bio: viewer.bio,
          analysisCount: vv?.analysis_count ?? 0,
          goals: goalsMap.get(viewer.id) ?? [], offerings: offersMap.get(viewer.id) ?? [],
          needVectors: (vv?.need_vectors as NeedVector[]) ?? [],
          offerVectors: (vv?.offer_vectors as OfferVector[]) ?? [],
          topicVectors: (vv?.topic_vectors as TopicVector[]) ?? [],
          engagementSignature: (vv?.engagement_signature ?? {}) as EngagementSignature,
        },
        target: {
          id: target.id, name: target.name, industry: target.industry, position: target.position, bio: target.bio, company: target.company,
          analysisCount: tv?.analysis_count ?? 0,
          goals: goalsMap.get(target.id) ?? [], offerings: offersMap.get(target.id) ?? [],
          needVectors: (tv?.need_vectors as NeedVector[]) ?? [],
          offerVectors: (tv?.offer_vectors as OfferVector[]) ?? [],
          topicVectors: (tv?.topic_vectors as TopicVector[]) ?? [],
          engagementSignature: (tv?.engagement_signature ?? {}) as EngagementSignature,
        },
        sharedMeetingCount: shared, config,
        judgeCacheFwd: fwdJ, judgeCacheRev: revJ, embeddingScores: emb,
      });

      const baseReasons = generateReasonsV2({
        target: { name: target.name, industry: target.industry, position: target.position, company: target.company },
        ...result,
        sharedMeetingCount: shared,
      });
      const reasons = [...result.reasons, ...baseReasons].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 5);

      rows.push({
        viewer_id: viewer.id, target_id: target.id,
        need_offer_score: result.needOfferScore, reverse_match: result.reverseMatch,
        expertise_fit: result.expertiseFit, topic_alignment: result.topicAlignment,
        engagement_value: result.engagementValue, history_score: result.historyScore,
        total_score: result.totalScore, confidence: result.confidence,
        phase: result.phase, score_reasons: reasons, notify_tier: result.notifyTier,
        is_stale: false, config_version: cfgRow.version_id, algorithm_version: "v2.0",
        calculated_at: new Date().toISOString(),
      });
    }
  }

  console.log(`[run-compute-all] computed ${rows.length} pairs`);
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await sb.from("matching_scores_v4").upsert(batch, { onConflict: "viewer_id,target_id" });
    if (error) console.error("upsert error:", error.message);
  }
  console.log("[run-compute-all] done");
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
