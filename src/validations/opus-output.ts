import { z } from "zod/v4";
// Worker からは直接インポートせず、analyze.ts にインライン定義。
// フロントエンド API からはこちらを使用。

const CATEGORIES = [
  "sales", "marketing", "technology", "finance", "hr", "legal",
  "operations", "strategy", "design", "industry", "leadership", "other",
] as const;

const CREDIBILITY = ["実績", "自己申告", "推論"] as const;

// --- Needs ---
const needSchema = z.object({
  text: z.string().min(3).max(500),
  explicit: z.boolean(),
  confidence: z.number().min(0.3).max(1.0),
  evidence: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
  solver_profile: z.string().min(10).max(300),
  urgency_signals: z.array(z.string()).default([]),
  category: z.enum(CATEGORIES),
  subcategory: z.string(),
});

// --- Offers ---
const offerSchema = z.object({
  text: z.string().min(3).max(500),
  explicit: z.boolean(),
  confidence: z.number().min(0.3).max(1.0),
  evidence: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
  beneficiary_profile: z.string().min(10).max(300),
  credibility: z.enum(CREDIBILITY),
  category: z.enum(CATEGORIES),
  subcategory: z.string(),
});

// --- Conversation Dynamics ---
const conversationDynamicsSchema = z.object({
  rapport: z.number().min(0).max(1),
  information_asymmetry: z.number().min(0).max(1),
  unspoken_tensions: z.array(z.string()).default([]),
  follow_up_potential: z.boolean(),
});

// --- Topic Depth ---
const topicDepthSchema = z.object({
  topic: z.string(),
  category: z.enum(CATEGORIES),
  depth: z.number().min(0).max(1),
});

// --- Engagement Behaviors ---
const engagementBehaviorsSchema = z.object({
  asks_clarifying_questions: z.boolean(),
  references_own_experience: z.boolean(),
  shows_active_listening: z.boolean(),
  contributes_solutions: z.boolean(),
  expresses_interest_follow_up: z.boolean(),
});

// --- Evidence Quote ---
const evidenceQuoteSchema = z.object({
  field: z.enum(["needs", "offers", "dynamics"]),
  index: z.number().min(0),
  quote: z.string().min(3),
});

// --- Complete Opus v3.0.0 Output ---
export const opusV3OutputSchema = z.object({
  needs: z.array(needSchema).default([]),
  offers: z.array(offerSchema).default([]),
  conversation_dynamics: conversationDynamicsSchema,
  topic_depth: z.array(topicDepthSchema).default([]),
  engagement_behaviors: engagementBehaviorsSchema,
  evidence_quotes: z.array(evidenceQuoteSchema).default([]),
  key_statements: z.array(z.string()).max(5).default([]),
});

export type OpusV3Output = z.infer<typeof opusV3OutputSchema>;

// --- Lenient version (for fallback parsing) ---
export const opusV3LenientSchema = z.object({
  needs: z.array(z.any()).default([]),
  offers: z.array(z.any()).default([]),
  conversation_dynamics: z.any().default({}),
  topic_depth: z.array(z.any()).default([]),
  engagement_behaviors: z.any().default({}),
  evidence_quotes: z.array(z.any()).default([]),
  key_statements: z.array(z.string()).default([]),
});
