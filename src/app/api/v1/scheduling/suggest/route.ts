/**
 * POST /api/v1/scheduling/suggest
 *
 * 双方の availability + freebusy から共通空き時間を返す。
 *
 * Body:
 *   { other_user_id: UUID, duration_min: 30|45|60|90, days: 7..30 }
 *
 * Response:
 *   { slots: [{ start, end }], proposer_has_calendar: bool, target_has_calendar: bool }
 *
 * 認証必須。connection 成立済の相手のみ対象。
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
  checkDbRateLimit,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";
import { getValidGoogleAccessToken } from "@/lib/calendar/access-token";
import { queryFreeBusy } from "@/lib/calendar/google";
import {
  findSelfFreeSlots,
  intersectSlots,
  type AvailRule,
  type AvailOverride,
} from "@/lib/calendar/slot-finder";
import { MEETING_DURATION_MIN } from "@/types/calendar";

const SuggestSchema = z.object({
  other_user_id: z.string().refine(isValidUUID, "UUID 不正"),
  duration_min: z.union([
    z.literal(30),
    z.literal(45),
    z.literal(60),
    z.literal(90),
  ]),
  days: z.number().int().min(7).max(30).default(14),
});

const MAX_SLOTS = 30;

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request, {
      skipMemoryRl: true,
      burstLimit: { perSecond: 2 },
    });
    const allowed = await checkDbRateLimit(
      supabase,
      user.id,
      "scheduling.suggest",
      20,
      60,
      true,
    );
    if (!allowed) return jsonError(429, "RATE_LIMITED", "請求過多");

    const raw: unknown = await request.json().catch(() => null);
    const parsed = SuggestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }
    const { other_user_id, duration_min, days } = parsed.data;
    if (!MEETING_DURATION_MIN.includes(duration_min)) {
      return jsonError(400, "BAD_REQUEST", "duration_min 不正");
    }

    // Connection 確認
    const { data: connection } = await supabase
      .from("connections")
      .select("id, status")
      .or(
        `and(user_id.eq.${user.id},connected_user_id.eq.${other_user_id}),and(user_id.eq.${other_user_id},connected_user_id.eq.${user.id})`,
      )
      .in("status", ["accepted", "reaccepted"])
      .maybeSingle();
    if (!connection) {
      return jsonError(403, "FORBIDDEN", "未接続のユーザーです");
    }

    const windowStart = new Date();
    const windowEnd = new Date(Date.now() + days * 86_400_000);

    // 双方の rules / overrides
    const [{ data: aRules }, { data: aOverrides }, { data: bRules }, { data: bOverrides }] =
      await Promise.all([
        supabase
          .from("availability_rules")
          .select("day_of_week, start_time, end_time, is_active")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .abortSignal(request.signal),
        supabase
          .from("availability_overrides")
          .select("target_date, override_type, start_time, end_time")
          .eq("user_id", user.id)
          .gte("target_date", windowStart.toISOString().slice(0, 10))
          .abortSignal(request.signal),
        supabase
          .from("availability_rules")
          .select("day_of_week, start_time, end_time, is_active")
          .eq("user_id", other_user_id)
          .eq("is_active", true)
          .abortSignal(request.signal),
        supabase
          .from("availability_overrides")
          .select("target_date, override_type, start_time, end_time")
          .eq("user_id", other_user_id)
          .gte("target_date", windowStart.toISOString().slice(0, 10))
          .abortSignal(request.signal),
      ]);

    // 双方の freebusy (token 取得は service_role 必須)
    const sb = await createServiceClient();
    const [aTok, bTok] = await Promise.all([
      getValidGoogleAccessToken(sb, user.id),
      getValidGoogleAccessToken(sb, other_user_id),
    ]);
    const proposerHasCalendar = !!aTok;
    const targetHasCalendar = !!bTok;

    const [aBusy, bBusy] = await Promise.all([
      aTok
        ? queryFreeBusy(aTok.accessToken, windowStart.toISOString(), windowEnd.toISOString())
        : Promise.resolve({ busy: [] }),
      bTok
        ? queryFreeBusy(bTok.accessToken, windowStart.toISOString(), windowEnd.toISOString())
        : Promise.resolve({ busy: [] }),
    ]);

    const aFree = findSelfFreeSlots({
      windowStart,
      windowEnd,
      rules: (aRules ?? []) as AvailRule[],
      overrides: (aOverrides ?? []) as AvailOverride[],
      busy: aBusy.busy,
      durationMin: duration_min,
    });
    const bFree = findSelfFreeSlots({
      windowStart,
      windowEnd,
      rules: (bRules ?? []) as AvailRule[],
      overrides: (bOverrides ?? []) as AvailOverride[],
      busy: bBusy.busy,
      durationMin: duration_min,
    });

    const common = intersectSlots(aFree, bFree, duration_min).slice(0, MAX_SLOTS);

    return json({
      slots: common,
      proposer_has_calendar: proposerHasCalendar,
      target_has_calendar: targetHasCalendar,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
