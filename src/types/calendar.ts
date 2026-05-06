/**
 * src/types/calendar.ts
 *
 * Calendar / Scheduling 関連 SSOT。
 */

import type { Database } from "@/types/database";

export type CalendarConnection =
  Database["public"]["Tables"]["calendar_connections"]["Row"];
export type AvailabilityRule =
  Database["public"]["Tables"]["availability_rules"]["Row"];
export type AvailabilityOverride =
  Database["public"]["Tables"]["availability_overrides"]["Row"];

export type CalendarProvider = "google" | "microsoft" | "ics_feed";
export const CALENDAR_PROVIDERS = [
  "google",
  "microsoft",
  "ics_feed",
] as const satisfies readonly CalendarProvider[];

export type MeetingPlatform = "google_meet" | "zoom_pmi" | "zoom_oauth";

// chat_messages.payload schema (scheduling_card / meeting_suggestion / meeting_confirmed 用)
// migration 00027 で chat_messages.payload JSONB 追加済

export interface SchedulingProposalPayload {
  schema_version: 1;
  suggestion_id: string;       // UUID
  proposed_slots: Array<{
    start: string;             // ISO 8601 with TZ
    end: string;
  }>;
  duration_min: 30 | 45 | 60 | 90;
  location: { type: MeetingPlatform; url?: string };
  proposer_user_id: string;
  expires_at: string;          // ISO
  status: "pending" | "accepted" | "rejected" | "expired";
}

export interface MeetingConfirmedPayload {
  schema_version: 1;
  proposal_id: string;
  calendar_event_id_organizer: string;   // Google event id (organizer 側)
  calendar_event_id_invitee?: string;    // 招待者側 (Google) もしくは省略
  meeting_url: string;                   // Google Meet / Zoom URL
  start: string;
  end: string;
  ics_url?: string;
}

export const MEETING_DURATION_MIN = [30, 45, 60, 90] as const;

// Google Calendar API
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
] as const;
