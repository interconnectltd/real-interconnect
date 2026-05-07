/**
 * GET /api/v1/scheduling/rules — 自分の曜日別営業時間ルール一覧
 * PUT /api/v1/scheduling/rules — { rules: [...] } で全置換 (transactional)
 *
 * settings/page.tsx の WeeklyTemplate UI 用。既存
 * /api/v1/calendar/availability は単体 CRUD 設計だが、UI は週単位で全置換
 * したいため別 endpoint として薄く実装する。
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

const RuleSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  is_active: z.boolean().optional(),
});

const PutSchema = z.object({
  rules: z.array(RuleSchema).max(7),
});

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { data, error } = await supabase
      .from("availability_rules")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("user_id", user.id)
      .order("day_of_week", { ascending: true })
      .abortSignal(request.signal);
    if (error) throw error;
    return json({ data: data ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const raw: unknown = await request.json().catch(() => null);
    const parsed = PutSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "rules 配列が不正です",
      );
    }

    // 同曜日重複の事前チェック (DB 側に UNIQUE 無い)
    const seenDays = new Set<number>();
    for (const r of parsed.data.rules) {
      if (seenDays.has(r.day_of_week)) {
        return jsonError(400, "BAD_REQUEST", "同じ曜日の重複は不可");
      }
      seenDays.add(r.day_of_week);
      if (r.end_time <= r.start_time) {
        return jsonError(400, "BAD_REQUEST", "終了時刻は開始時刻より後にしてください");
      }
    }

    // 全削除 → 再 insert (RLS により自分の行のみ操作)
    const { error: delError } = await supabase
      .from("availability_rules")
      .delete()
      .eq("user_id", user.id);
    if (delError) throw delError;

    if (parsed.data.rules.length > 0) {
      const rows = parsed.data.rules.map((r) => ({
        user_id: user.id,
        day_of_week: r.day_of_week,
        start_time: r.start_time,
        end_time: r.end_time,
        is_active: r.is_active ?? true,
      }));
      const { error: insError } = await supabase
        .from("availability_rules")
        .insert(rows);
      if (insError) throw insError;
    }

    return json({ data: { saved: parsed.data.rules.length } });
  } catch (error) {
    return handleApiError(error);
  }
}
