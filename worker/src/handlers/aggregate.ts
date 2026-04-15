/**
 * aggregate ハンドラ: transcript_insights → member_ai_profiles_v2 集約
 * ARCHITECTURE.md §4.1 Step 5
 *
 * 頻度重み: 1回=1.0, 2回=2.0, 3回+=3.0
 * 時間減衰: 3ヶ月:1.0, 6ヶ月:0.7, 超:0.4
 */

import { supabase } from "../queue";
import { enqueueJob } from "../queue";

function timeDecay(dateStr: string): number {
  const months = (Date.now() - new Date(dateStr).getTime()) / (30 * 86400000);
  if (months <= 3) return 1.0;
  if (months <= 6) return 0.7;
  return 0.4;
}

function freqWeight(count: number): number {
  if (count >= 3) return 3.0;
  if (count === 2) return 2.0;
  return 1.0;
}

interface AggItem {
  text: string;
  category?: string;
  subcategory?: string;
  frequency: number;
  weight: number;
  last_seen: string;
  // V2 fields
  solver_profile?: string;
  beneficiary_profile?: string;
  explicit?: boolean;
  confidence?: number;
  signals?: string[];
  credibility?: number;
  urgency_signals?: string[];
  evidence?: string[];
}

export async function handleAggregate(payload: {
  user_id: string;
}): Promise<void> {
  const { user_id } = payload;

  // この user に紐づく全 insights を取得
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

  // 集約: skills, needs, offerings, communication_profile
  const skillsMap = new Map<string, AggItem>();
  const needsMap = new Map<string, AggItem>();
  const offeringsMap = new Map<string, AggItem>();
  const commTraits: { assertiveness: number[]; collaboration: number[]; analytical: number[]; empathy: number[] } = {
    assertiveness: [], collaboration: [], analytical: [], empathy: [],
  };

  for (const insight of insights) {
    const meetingDate = (insight.transcript as { meeting_date?: string })?.meeting_date ?? insight.created_at;

    // Skills
    for (const skill of (insight.demonstrated_skills ?? []) as string[]) {
      const existing = skillsMap.get(skill);
      if (existing) {
        existing.frequency++;
        existing.weight = freqWeight(existing.frequency) * timeDecay(meetingDate);
        existing.last_seen = meetingDate > existing.last_seen ? meetingDate : existing.last_seen;
      } else {
        skillsMap.set(skill, {
          text: skill, frequency: 1, weight: 1.0 * timeDecay(meetingDate), last_seen: meetingDate,
        });
      }
    }

    // Needs (JSONB[])
    for (const need of (insight.expressed_needs ?? []) as {
      text?: string; category?: string; subcategory?: string;
      solver_profile?: string; explicit?: boolean; confidence?: number;
      signals?: string[]; urgency_signals?: string[]; evidence?: string[];
    }[]) {
      const key = typeof need === "string" ? need : need.text ?? JSON.stringify(need);
      const existing = needsMap.get(key);
      if (existing) {
        existing.frequency++;
        existing.weight = freqWeight(existing.frequency) * timeDecay(meetingDate);
        if (meetingDate > existing.last_seen) {
          existing.last_seen = meetingDate;
          // Keep the most recent V2 fields
          if (typeof need === "object") {
            if (need.solver_profile) existing.solver_profile = need.solver_profile;
            if (need.explicit != null) existing.explicit = need.explicit;
            if (need.confidence != null && (existing.confidence == null || need.confidence > existing.confidence)) existing.confidence = need.confidence;
            if (need.signals?.length) existing.signals = need.signals;
            if (need.urgency_signals?.length) existing.urgency_signals = need.urgency_signals;
            if (need.evidence?.length) existing.evidence = [...(existing.evidence ?? []), ...need.evidence];
          }
        }
      } else {
        needsMap.set(key, {
          text: key,
          category: typeof need === "object" ? need.category : undefined,
          subcategory: typeof need === "object" ? need.subcategory : undefined,
          frequency: 1, weight: 1.0 * timeDecay(meetingDate), last_seen: meetingDate,
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

    // Offerings (同様)
    for (const off of (insight.offered_capabilities ?? []) as {
      text?: string; category?: string; subcategory?: string;
      beneficiary_profile?: string; explicit?: boolean; confidence?: number;
      signals?: string[]; credibility?: number; evidence?: string[];
    }[]) {
      const key = typeof off === "string" ? off : off.text ?? JSON.stringify(off);
      const existing = offeringsMap.get(key);
      if (existing) {
        existing.frequency++;
        existing.weight = freqWeight(existing.frequency) * timeDecay(meetingDate);
        if (meetingDate > existing.last_seen) {
          existing.last_seen = meetingDate;
          // Keep the most recent V2 fields
          if (typeof off === "object") {
            if (off.beneficiary_profile) existing.beneficiary_profile = off.beneficiary_profile;
            if (off.explicit != null) existing.explicit = off.explicit;
            if (off.confidence != null && (existing.confidence == null || off.confidence > existing.confidence)) existing.confidence = off.confidence;
            if (off.signals?.length) existing.signals = off.signals;
            if (off.credibility != null) existing.credibility = off.credibility;
            if (off.evidence?.length) existing.evidence = [...(existing.evidence ?? []), ...off.evidence];
          }
        }
      } else {
        offeringsMap.set(key, {
          text: key,
          category: typeof off === "object" ? off.category : undefined,
          subcategory: typeof off === "object" ? off.subcategory : undefined,
          frequency: 1, weight: 1.0 * timeDecay(meetingDate), last_seen: meetingDate,
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

    // Communication traits (加重平均用)
    const traits = insight.communication_traits as Record<string, number> | null;
    if (traits) {
      const decay = timeDecay(meetingDate);
      if (traits.assertiveness != null) commTraits.assertiveness.push(traits.assertiveness * decay);
      if (traits.collaboration != null) commTraits.collaboration.push(traits.collaboration * decay);
      if (traits.analytical != null) commTraits.analytical.push(traits.analytical * decay);
      if (traits.empathy != null) commTraits.empathy.push(traits.empathy * decay);
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 50;

  // UPSERT member_ai_profiles_v2
  await supabase.from("member_ai_profiles_v2").upsert(
    {
      user_id,
      aggregated_skills: [...skillsMap.values()],
      aggregated_needs: [...needsMap.values()],
      aggregated_offerings: [...offeringsMap.values()],
      communication_profile: {
        assertiveness: avg(commTraits.assertiveness),
        collaboration: avg(commTraits.collaboration),
        analytical: avg(commTraits.analytical),
        empathy: avg(commTraits.empathy),
      },
      analysis_count: insights.length,
      last_analyzed_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // mark_cache_stale トリガーが発火 → is_stale=true
  // score ジョブを投入
  await enqueueJob("score", { user_id }, 3);
}
