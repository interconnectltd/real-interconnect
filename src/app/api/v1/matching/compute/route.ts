import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { computeScore, type ScoreInput } from "@/lib/matching";
import type { Profile } from "@/types";

/**
 * POST /api/v1/matching/compute
 *
 * 呼び出し元のユーザーと全アクティブユーザー間のスコアを計算し、
 * matching_scores_v3 に UPSERT する。
 *
 * ローンチ初期は attribute_only Phase で動作。
 * Worker パイプライン完成後は Worker 側に移行予定。
 */
export async function POST() {
  try {
    const { user, supabase } = await withAuth();

    // レート制限: 直近5分以内に計算済みなら早期リターン
    const { data: recentScore } = await supabase
      .from("matching_scores_v3")
      .select("calculated_at")
      .eq("viewer_id", user.id)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentScore?.calculated_at) {
      const elapsed = Date.now() - new Date(recentScore.calculated_at).getTime();
      if (elapsed < 5 * 60 * 1000) {
        return json({ computed: 0, skipped: true });
      }
    }

    // 自分のプロフィール取得
    const { data: myProfile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!myProfile) return json({ computed: 0 });

    // 自分のAIプロフィール取得（あれば）
    const { data: myAi } = await supabase
      .from("member_ai_profiles_v2")
      .select("analysis_count, aggregated_needs, aggregated_offerings, aggregated_skills, communication_profile")
      .eq("user_id", user.id)
      .maybeSingle();

    // 全アクティブユーザー取得（自分除外）
    const { data: targets } = await supabase
      .from("user_profiles")
      .select("id, name, company, position, industry, bio, avatar_url")
      .eq("is_active", true)
      .neq("id", user.id)
      .limit(500);

    if (!targets?.length) return json({ computed: 0 });

    // 各targetのAIプロフィール取得
    const targetIds = targets.map((t) => t.id);
    const { data: targetAis } = await supabase
      .from("member_ai_profiles_v2")
      .select("user_id, analysis_count, aggregated_needs, aggregated_offerings, aggregated_skills, communication_profile")
      .in("user_id", targetIds);

    const aiMap = new Map(targetAis?.map((a) => [a.user_id, a]) ?? []);

    // 自分の goals/offerings 取得
    const { data: myGoals } = await supabase
      .from("user_goals")
      .select("type, context")
      .eq("user_id", user.id);

    const { data: myOfferings } = await supabase
      .from("user_offerings")
      .select("type, context")
      .eq("user_id", user.id);

    // 全ターゲットの goals/offerings 取得
    const { data: allGoals } = await supabase
      .from("user_goals")
      .select("user_id, type, context")
      .in("user_id", targetIds);

    const { data: allOfferings } = await supabase
      .from("user_offerings")
      .select("user_id, type, context")
      .in("user_id", targetIds);

    const goalsMap = new Map<string, { type: string; context: string | null }[]>();
    const offeringsMap = new Map<string, { type: string; context: string | null }[]>();

    for (const g of allGoals ?? []) {
      if (!goalsMap.has(g.user_id)) goalsMap.set(g.user_id, []);
      goalsMap.get(g.user_id)!.push({ type: g.type, context: g.context });
    }
    for (const o of allOfferings ?? []) {
      if (!offeringsMap.has(o.user_id)) offeringsMap.set(o.user_id, []);
      offeringsMap.get(o.user_id)!.push({ type: o.type, context: o.context });
    }

    // ── AI集約データからのスコア計算ヘルパー ──

    // communication_profile の互換性スコア (0-1)
    type CommProfile = { assertiveness: number; collaboration: number; analytical: number; empathy: number };
    const calcConversationScore = (
      a: CommProfile | null | undefined,
      b: CommProfile | null | undefined,
    ): number => {
      if (!a || !b) return 0;
      const traits: (keyof CommProfile)[] = ["assertiveness", "collaboration", "analytical", "empathy"];
      let sum = 0;
      let count = 0;
      for (const t of traits) {
        const va = typeof a[t] === "number" ? a[t] : null;
        const vb = typeof b[t] === "number" ? b[t] : null;
        if (va != null && vb != null) {
          sum += 1 - Math.abs(va - vb) / 100;
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    };

    // aggregated items からテキスト配列を抽出
    type AggItem = { text?: string };
    const extractTexts = (items: unknown): string[] => {
      if (!Array.isArray(items)) return [];
      return items
        .filter((i): i is AggItem => i != null && typeof (i as AggItem).text === "string")
        .map((i) => (i.text as string).toLowerCase());
    };

    // テキストマッチ: viewerのneeds vs targetのofferings (部分一致)
    const findMatches = (needsTexts: string[], offeringsTexts: string[]): string[] => {
      const matched: string[] = [];
      for (const need of needsTexts) {
        for (const offering of offeringsTexts) {
          if (need === offering || offering.includes(need) || need.includes(offering)) {
            matched.push(need);
            break;
          }
        }
      }
      return matched;
    };

    // バッチ内重複抑制用
    const usedTemplateIds = new Set<string>();

    // viewer の AI集約データ
    const myCommProfile = myAi?.communication_profile as CommProfile | null;
    const myAggNeeds = extractTexts(myAi?.aggregated_needs);
    const myAggOfferings = extractTexts(myAi?.aggregated_offerings);
    const myAggSkills = extractTexts(myAi?.aggregated_skills);

    // スコア計算
    const rows = targets.map((target) => {
      const targetAi = aiMap.get(target.id);

      // AI会話スコア計算
      const targetCommProfile = targetAi?.communication_profile as CommProfile | null;
      const conversationScore = calcConversationScore(myCommProfile, targetCommProfile);

      // needs/offerings/skills マッチ
      const targetAggNeeds = extractTexts(targetAi?.aggregated_needs);
      const targetAggOfferings = extractTexts(targetAi?.aggregated_offerings);
      const targetAggSkills = extractTexts(targetAi?.aggregated_skills);

      const matchedNeeds = findMatches(myAggNeeds, targetAggOfferings);
      const matchedOfferings = findMatches(myAggOfferings, targetAggNeeds);
      const matchedSkills = findMatches(myAggSkills, targetAggSkills);

      const input: ScoreInput = {
        viewer: {
          id: user.id,
          industry: myProfile.industry,
          position: myProfile.position,
          bio: myProfile.bio,
          goals: myGoals ?? [],
          offerings: myOfferings ?? [],
          analysisCount: myAi?.analysis_count ?? 0,
        },
        target: {
          id: target.id,
          name: target.name,
          industry: target.industry,
          position: target.position,
          bio: target.bio,
          company: target.company,
          analysisCount: targetAi?.analysis_count ?? 0,
          goals: goalsMap.get(target.id) ?? [],
          offerings: offeringsMap.get(target.id) ?? [],
        },
        aiScores: conversationScore > 0 ? { conversation: conversationScore } : undefined,
        matchedNeeds,
        matchedOfferings,
        matchedSkills,
        sharedMeetingCount: 0,
        usedTemplateIds,
      };

      const forward = computeScore(input);

      // 逆方向スコアも計算 (target → viewer)
      const reverseUsedIds = new Set<string>();
      const reverseMatchedNeeds = findMatches(targetAggNeeds, myAggOfferings);
      const reverseMatchedOfferings = findMatches(targetAggOfferings, myAggNeeds);
      const reverseMatchedSkills = findMatches(targetAggSkills, myAggSkills);

      const reverseInput: ScoreInput = {
        viewer: {
          id: target.id,
          industry: target.industry,
          position: target.position,
          bio: target.bio,
          analysisCount: targetAi?.analysis_count ?? 0,
          goals: goalsMap.get(target.id) ?? [],
          offerings: offeringsMap.get(target.id) ?? [],
        },
        target: {
          id: user.id,
          name: myProfile.name,
          industry: myProfile.industry,
          position: myProfile.position,
          bio: myProfile.bio,
          company: myProfile.company,
          analysisCount: myAi?.analysis_count ?? 0,
          goals: myGoals ?? [],
          offerings: myOfferings ?? [],
        },
        aiScores: conversationScore > 0 ? { conversation: conversationScore } : undefined,
        matchedNeeds: reverseMatchedNeeds,
        matchedOfferings: reverseMatchedOfferings,
        matchedSkills: reverseMatchedSkills,
        sharedMeetingCount: 0,
        usedTemplateIds: reverseUsedIds,
      };
      const reverse = computeScore(reverseInput);

      return [
        {
          viewer_id: user.id,
          target_id: target.id,
          value_fit: forward.valueFit,
          relational_quality: forward.relationalQuality,
          total_score: forward.totalScore,
          confidence: forward.confidence,
          phase: forward.phase,
          score_reasons: forward.reasons,
          notify_tier: forward.notifyTier,
          is_stale: false,
        },
        {
          viewer_id: target.id,
          target_id: user.id,
          value_fit: reverse.valueFit,
          relational_quality: reverse.relationalQuality,
          total_score: reverse.totalScore,
          confidence: reverse.confidence,
          phase: reverse.phase,
          score_reasons: reverse.reasons,
          notify_tier: reverse.notifyTier,
          is_stale: false,
        },
      ];
    });

    const allRows = rows.flat();

    // UPSERT (50件ずつバッチ)
    let computed = 0;
    for (let i = 0; i < allRows.length; i += 50) {
      const batch = allRows.slice(i, i + 50);
      const { error } = await supabase
        .from("matching_scores_v3")
        .upsert(batch, { onConflict: "viewer_id,target_id" });

      if (error) {
        console.error("Score upsert error:", error);
      } else {
        computed += batch.length;
      }
    }

    return json({ computed });
  } catch (error) {
    return handleApiError(error);
  }
}
