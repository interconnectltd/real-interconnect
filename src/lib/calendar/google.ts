/**
 * src/lib/calendar/google.ts
 *
 * Google Calendar API クライアント。Phase B 用。
 *
 * - OAuth 2.0 token exchange / refresh
 * - freebusy.query: 双方の空き時間取得
 * - events.insert: Meet 自動生成 + 招待
 * - events.delete / patch: キャンセル / 時間変更
 *
 * R3 Phase B レビュー指摘の対応:
 * - access_type=offline + prompt=consent で refresh_token を確実取得
 * - openid email scope で provider_email 識別
 * - conferenceDataVersion=1 で Meet auto-create
 */

import { GOOGLE_OAUTH_SCOPES } from "@/types/calendar";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
}

export interface UserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export function buildAuthUrl(state: string): string {
  const cid = requireEnv("GOOGLE_CLIENT_ID");
  const redirect = requireEnv("GOOGLE_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: cid,
    redirect_uri: redirect,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // refresh_token を毎回取得
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    grant_type: "authorization_code",
  });
  return await postForm<TokenResponse>(TOKEN_ENDPOINT, body);
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  return await postForm<TokenResponse>(TOKEN_ENDPOINT, body);
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const r = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Google userinfo failed: ${r.status}`);
  return r.json();
}

export interface FreeBusyRange {
  start: string; // ISO
  end: string;
}
export interface FreeBusyResponse {
  busy: FreeBusyRange[];
}

export async function queryFreeBusy(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  timeZone = "Asia/Tokyo",
): Promise<FreeBusyResponse> {
  const r = await fetch(FREEBUSY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone,
      items: [{ id: "primary" }],
    }),
  });
  if (!r.ok) throw new Error(`Google freebusy failed: ${r.status}`);
  const j = (await r.json()) as {
    calendars?: { primary?: { busy?: FreeBusyRange[] } };
  };
  return { busy: j.calendars?.primary?.busy ?? [] };
}

export interface CreateMeetEventInput {
  accessToken: string;
  summary: string;
  description?: string;
  start: string; // ISO
  end: string;
  attendees: Array<{ email: string; displayName?: string }>;
  timeZone?: string;
}

export interface CreatedEvent {
  id: string;
  hangoutLink?: string;
  htmlLink: string;
  iCalUID: string;
}

export async function createMeetEvent(
  input: CreateMeetEventInput,
): Promise<CreatedEvent> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const url = `${EVENTS_ENDPOINT}?conferenceDataVersion=1`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start, timeZone: input.timeZone ?? "Asia/Tokyo" },
      end: { dateTime: input.end, timeZone: input.timeZone ?? "Asia/Tokyo" },
      attendees: input.attendees,
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Google events.insert failed: ${r.status} ${err}`);
  }
  const j = (await r.json()) as {
    id: string;
    hangoutLink?: string;
    htmlLink: string;
    iCalUID: string;
  };
  return j;
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const r = await fetch(`${EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok && r.status !== 410 /* already deleted */) {
    throw new Error(`Google events.delete failed: ${r.status}`);
  }
}

// ─── helpers ───
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} not set`);
  return v;
}

async function postForm<T>(url: string, body: URLSearchParams): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`OAuth ${r.status}: ${err}`);
  }
  return r.json() as Promise<T>;
}
