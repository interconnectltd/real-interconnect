/**
 * aggregate ハンドラ V2: transcript_insights → member_ai_profiles_v2 + user_conversation_vectors
 * SCORING_V2_ARCHITECTURE.md §2 — 集約エンジン（レイヤー1.5）
 *
 * Step 2 変更点:
 * - timeDecay V2 仕様 (3-6mo=0.5, 6+mo=0.25)
 * - urgency 推定 (mention_count / totalMeetings)
 * - topic_vectors, engagement_signature, evidence_index 構築
 * - implicit confidence 累積
 * - user_conversation_vectors 並行書込
 */

import { supabase } from "../queue";
import { enqueueJob } from "../queue";

// --- V2 時間減衰 (SCORING_V2_ARCHITECTURE §2.3) ---
function timeDecay(dateStr: string): number {
  const months = (Date.now() - new Date(dateStr).getTime()) / (30 * 86400000);
  if (months <= 3) return 1.0;
  if (months <= 6) return 0.5;
  return 0.25;
}

function freqWeight(count: number): number {
  if (count >= 3) return 3.0;
  if (count === 2) return 2.0;
  return 1.0;
}

// --- V2 urgency 推定 (DESIGN.csv row 19) ---
function calcUrgency(mentionCount: number, totalMeetings: number): "high" | "medium" | "low" {
  if (totalMeetings === 0) return "low";
  const ratio = mentionCount / totalMeetings;
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.5) return "medium";
  return "low";
}

// --- 型定義 ---
interface AggItem {
  text: string;
  category?: string;
  subcategory?: string;
  frequency: number;
  weight: number;
  last_seen: string;
  solver_profile?: string;
  beneficiary_profile?: string;
  explicit?: boolean;
  confidence?: number;
  signals?: string[];
  credibility?: string;
  urgency_signals?: string[];
  evidence?: string[];
}

interface TopicEntry {
  topic: string;
  category?: string;
  depth: number;
  mention_count: number;
  decay_weight: number;
  last_mentioned: string;
}

// --- V3 insight の型ヒント ---
interface V3Need {
  text?: string;
  category?: string;
  subcategory?: string;
  solver_profile?: string;
  explicit?: boolean;
  confidence?: number;
  signals?: string[];
  urgency_signals?: string[];
  evidence?: string[];
}

interface V3Offer {
  text?: string;
  category?: string;
  subcategory?: string;
  beneficiary_profile?: string;
  explicit?: boolean;
  confidence?: number;
  signals?: string[];
  credibility?: string;
  evidence?: string[];
}

export async function handleAggregate(payload: {
  user_id: string;
}): Promise<void> {
  const { user_id } = payload;

  const { data: participants } = await supabase
    .from("meeting_participants")
    .select("id, transcript_id")
    .eq("user_id", user_id)
    .eq("is_linked", true);

  if (!participants?.length) return;

  const participantIds = participants.map((p) => p.id);

  const { data: insights } = await supabase
    .from("transcript_insights")
    .select("*, transcript:meeting_transcripts(meeting_date)")
    .in("participant_id", participantIds)
    .order("created_at", { ascending: false });

  if (!insights?.length) return;

  // ==============================
  // 集約マップ
  // ==============================
  const skillsMap = new Map<string, AggItem>();
  const needsMap = new Map<string, AggItem>();
  const offeringsMap = new Map<string, AggItem>();
  const topicMap = new Map<string, TopicEntry>();
  const commTraits = {
    assertiveness: [] as number[],
    collaboration: [] as number[],
    analytical: [] as number[],
    empathy: [] as number[],
  };
  const engagementCounts = {
    asks_clarifying_questions: 0,
    references_own_experience: 0,
    shows_active_listening: 0,
    contributes_solutions: 0,
    expresses_interest_follow_up: 0,
  };
  const evidenceIndex: Record<string, { quote: string; date: string }[]> = {};
  const totalMeetings = new Set(participants.map((p) => p.transcript_id)).size;

  // ==============================
  // メインループ
  // ==============================
  for (const insight of insights) {
    const meetingDate = (insight.transcript as { meeting_date?: string })?.meeting_date ?? insight.created_at;
    const decay = timeDecay(meetingDate);

    // --- Skills ---
    for (const skill of (insight.demonstrated_skills ?? []) as string[]) {
      if (!skill) continue;
      const existing = skillsMap.get(skill);
      if (existing) {
        existing.frequency++;
        existing.weight = freqWeight(existing.frequency) * decay;
        if (meetingDate > existing.last_seen) existing.last_seen = meetingDate;
      } else {
        skillsMap.set(skill, {
          text: skill, frequency: 1, weight: 1.0 * decay, last_seen: meetingDate,
        });
      }
    }

    // --- Needs ---
    for (const need of (insight.expressed_needs ?? []) as V3Need[]) {
      const key = typeof need === "string" ? need : need.text ?? JSON.stringify(need);
      if (!key) continue;
      const existing = needsMap.get(key);
      if (existing) {
        existing.frequency++;
        existing.weight = freqWeight(existing.frequency) * decay;
        if (meetingDate > existing.last_seen) existing.last_seen = meetingDate;
        if (typeof need === "object") {
          if (need.solver_profile) existing.solver_profile = need.solver_profile;
          if (need.explicit != null) existing.explicit = need.explicit;
          // implicit confidence 累積: 複数回言及で信頼度が積み上がる（上限0.90）
          if (need.confidence != null) {
            if (!existing.explicit && !need.explicit) {
              existing.confidence = Math.min(0.90, (existing.confidence ?? 0.5) + need.confidence * 0.2);
            } else if (need.confidence > (existing.confidence ?? 0)) {
              existing.confidence = need.confidence;
            }
          }
          if (need.signals?.length) existing.signals = need.signals;
          if (need.urgency_signals?.length) existing.urgency_signals = need.urgency_signals;
          if (need.evidence?.length) existing.evidence = [...(existing.evidence ?? []), ...need.evidence].slice(-5);
        }
      } else {
        needsMap.set(key, {
          text: key,
          category: typeof need === "object" ? need.category : undefined,
          subcategory: typeof need === "object" ? need.subcategory : undefined,
          frequency: 1, weight: 1.0 * decay, last_seen: meetingDate,
          ...(typeof need === "object" ? {
            solver_profile: need.solver_profile,
            explicit: need.explicit,
            confidence: need.confidence,
            signals: need.signals,
            urgency_signals: need.urgency_signals,
            evidence: need.evidence,
          } : {}),
        });
      }
    }

    // --- Offerings ---
    for (const off of (insight.offered_capabilities ?? []) as V3Offer[]) {
      const key = typeof off === "string" ? off : off.text ?? JSON.stringify(off);
      if (!key) continue;
      const existing = offeringsMap.get(key);
      if (existing) {
        existing.frequency++;
        existing.weight = freqWeight(existing.frequency) * decay;
        if (meetingDate > existing.last_seen) existing.last_seen = meetingDate;
        if (typeof off === "object") {
          if (off.beneficiary_profile) existing.beneficiary_profile = off.beneficiary_profile;
          if (off.explicit != null) existing.explicit = off.explicit;
          if (off.confidence != null) {
            if (!existing.explicit && !off.explicit) {
              existing.confidence = Math.min(0.90, (existing.confidence ?? 0.5) + off.confidence * 0.2);
            } else if (off.confidence > (existing.confidence ?? 0)) {
              existing.confidence = off.confidence;
            }
          }
          if (off.signals?.length) existing.signals = off.signals;
          if (off.credibility) existing.credibility = off.credibility;
          if (off.evidence?.length) existing.evidence = [...(existing.evidence ?? []), ...off.evidence].slice(-5);
        }
      } else {
        offeringsMap.set(key, {
          text: key,
          category: typeof off === "object" ? off.category : undefined,
          subcategory: typeof off === "object" ? off.subcategory : undefined,
          frequency: 1, weight: 1.0 * decay, last_seen: meetingDate,
          ...(typeof off === "object" ? {
            beneficiary_profile: off.beneficiary_profile,
            explicit: off.explicit,
            confidence: off.confidence,
            signals: off.signals,
            credibility: off.credibility,
            evidence: off.evidence,
          } : {}),
        });
      }
    }

    // --- Communication traits ---
    const traits = insight.communication_traits as Record<string, unknown> | null;
    if (traits) {
      if (typeof traits.rapport === "number") commTraits.assertiveness.push(traits.rapport * decay);
      if (typeof traits.assertiveness === "number") commTraits.assertiveness.push(traits.assertiveness * decay);
      if (typeof traits.collaboration === "number") commTraits.collaboration.push(traits.collaboration * decay);
      if (typeof traits.analytical === "number") commTraits.analytical.push(traits.analytical * decay);
      if (typeof traits.empathy === "number") commTraits.empathy.push(traits.empathy * decay);

      // --- Engagement behaviors (V2) ---
      const behaviors = traits.engagement_behaviors as Record<string, boolean> | undefined;
      if (behaviors) {
        for (const [key, val] of Object.entries(behaviors)) {
          if (val && key in engagementCounts) {
            engagementCounts[key as keyof typeof engagementCounts]++;
          }
        }
      }
    }

    // --- Topic depth (V2) ---
    const metrics = insight.engagement_metrics as { topic_depth?: { topic: string; category?: string; depth: number }[]; evidence_quotes?: { field: string; index: number; quote: string }[] } | null;
    if (metrics?.topic_depth) {
      for (const td of metrics.topic_depth) {
        if (!td.topic) continue;
        const existing = topicMap.get(td.topic);
        if (existing) {
          existing.mention_count++;
          existing.depth = Math.max(existing.depth, td.depth ?? 0);
          existing.decay_weight = decay;
          if (meetingDate > existing.last_mentioned) existing.last_mentioned = meetingDate;
        } else {
          topicMap.set(td.topic, {
            topic: td.topic,
            category: td.category,
            depth: td.depth ?? 0.5,
            mention_count: 1,
            decay_weight: decay,
            last_mentioned: meetingDate,
          });
        }
      }
    }

    // --- Evidence quotes (V2) ---
    if (metrics?.evidence_quotes) {
      for (const eq of metrics.evidence_quotes) {
        const field = eq.field || "other";
        if (!evidenceIndex[field]) evidenceIndex[field] = [];
        evidenceIndex[field].push({ quote: eq.quote, date: meetingDate });
      }
    }
  }

  // ==============================
  // ベクトル変換
  // ==============================
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 50;

  // need_vectors (V2 構造)
  const needVectors = [...needsMap.values()].map((item) => ({
    text: item.text,
    category: item.category,
    subcategory: item.subcategory,
    solver_profile: item.solver_profile,
    explicit: item.explicit ?? true,
    confidence: item.confidence ?? 0.7,
    signals: item.signals ?? [],
    urgency_signals: item.urgency_signals ?? [],
    urgency: calcUrgency(item.frequency, totalMeetings),
    frequency: item.frequency,
    weight: item.weight,
    decay_weight: timeDecay(item.last_seen),
    last_mentioned: item.last_seen,
    evidence: item.evidence ?? [],
  }));

  // offer_vectors (V2 構造)
  const offerVectors = [...offeringsMap.values()].map((item) => ({
    text: item.text,
    category: item.category,
    subcategory: item.subcategory,
    beneficiary_profile: item.beneficiary_profile,
    explicit: item.explicit ?? true,
    confidence: item.confidence ?? 0.7,
    signals: item.signals ?? [],
    credibility: item.credibility ?? "推論",
    frequency: item.frequency,
    weight: item.weight,
    decay_weight: timeDecay(item.last_seen),
    last_mentioned: item.last_seen,
    evidence: item.evidence ?? [],
  }));

  // expertise_vectors
  const expertiseVectors = [...skillsMap.values()].map((item) => ({
    skill: item.text,
    frequency: item.frequency,
    decay_weight: timeDecay(item.last_seen),
    last_mentioned: item.last_seen,
  }));

  // topic_vectors
  const topicVectors = [...topicMap.values()];

  // engagement_signature (ratios)
  const totalInsights = insights.length;
  const engagementSignature = Object.fromEntries(
    Object.entries(engagementCounts).map(([k, v]) => [
      k,
      totalInsights > 0 ? Math.round((v / totalInsights) * 100) / 100 : 0,
    ]),
  );

  // evidence_index: 各フィールド最新3件のみ保持
  const evidenceIndexTrimmed: Record<string, { quote: string; date: string }[]> = {};
  for (const [field, entries] of Object.entries(evidenceIndex)) {
    evidenceIndexTrimmed[field] = entries
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  }

  // meeting_ids
  const meetingIds = [...new Set(participants.map((p) => p.transcript_id).filter(Boolean))];

  // communication_profile
  const communicationProfile = {
    assertiveness: avg(commTraits.assertiveness),
    collaboration: avg(commTraits.collaboration),
    analytical: avg(commTraits.analytical),
    empathy: avg(commTraits.empathy),
  };

  // ==============================
  // 並行書込: member_ai_profiles_v2 + user_conversation_vectors
  // ==============================
  await Promise.all([
    // V1 互換: member_ai_profiles_v2
    supabase.from("member_ai_profiles_v2").upsert(
      {
        user_id,
        aggregated_skills: [...skillsMap.values()],
        aggregated_needs: [...needsMap.values()],
        aggregated_offerings: [...offeringsMap.values()],
        communication_profile: communicationProfile,
        analysis_count: insights.length,
        last_analyzed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ),
    // V2: user_conversation_vectors
    supabase.from("user_conversation_vectors").upsert(
      {
        user_id,
        need_vectors: needVectors,
        offer_vectors: offerVectors,
        expertise_vectors: expertiseVectors,
        topic_vectors: topicVectors,
        engagement_signature: engagementSignature,
        evidence_index: evidenceIndexTrimmed,
        analysis_count: insights.length,
        meeting_ids: meetingIds,
        last_analyzed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ),
  ]);

  // stale トリガー発火 → matching_scores_v4 is_stale=true
  // score ジョブ投入
  await enqueueJob("score", { user_id }, 3);
}
