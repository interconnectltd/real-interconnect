export type { Database, Json, ConnectionStatus, TranscriptStatus, NotificationType } from "./database";
import type { NotificationType } from "./database";

// ── App-level types ──

export interface Profile {
  id: string;
  name: string;
  email: string;
  company: string | null;
  position: string | null;
  industry: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  contact_info: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Connection {
  id: string;
  user_id: string;
  connected_user_id: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "disconnected" | "blocked" | "reaccepted";
  created_at: string;
  updated_at: string;
  profile?: Profile; // joined
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  actions: NotificationAction[] | null;
  is_read: boolean;
  created_at: string;
}

/** Allowed actions that can be rendered in notification UI */
export type NotificationActionType = "accept" | "reject" | "view_profile" | "view_matching";

export interface NotificationAction {
  type: NotificationActionType;
  label: string;
  href?: string;
  payload?: Record<string, string>;
}

export type ScorePhase = "attribute_only" | "hybrid" | "ai_primary";
export type NotifyTier = "high" | "medium" | "low";

export interface MatchScore {
  viewer_id: string;
  target_id: string;
  value_fit?: number;
  relational_quality?: number;
  need_offer_score?: number;
  reverse_match?: number;
  expertise_fit?: number;
  topic_alignment?: number;
  engagement_value?: number;
  total_score: number;
  confidence: number;
  phase: ScorePhase;
  reasons: string[];
  notify_tier: NotifyTier | null;
  target_profile?: Profile;
}

export interface MutualMatch {
  user_id: string;
  my_score: number;
  their_score: number;
  my_reasons: string[];
  profile: Profile | null;
}

export interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: {
    page: number;
    totalPages: number;
    totalCount: number;
  };
}
