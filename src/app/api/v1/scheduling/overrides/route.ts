/**
 * GET  /api/v1/scheduling/overrides — 自分の特定日例外一覧
 * POST /api/v1/scheduling/overrides — 1 件追加
 *
 * UI 側 override_type は "block" | "custom"、DB は "block" | "open"。
 * ここで双方向変換する。label (UI) ↔ reason (DB) も同様。
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

const PostSchema = z.object({
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  override_type: z.enum(["block", "custom"]),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  label: z.string().max(200).optional(),
});

interface DbOverride {
  id: string;
  target_date: string;
  override_type: "block" | "open";
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

function dbToUi(row: DbOverride) {
  return {
    id: row.id,
    target_date: row.target_date,
    override_type: row.override_type === "open" ? "custom" : "block",
    start_time: row.start_time,
    end_time: row.end_time,
    label: row.reason,
  };
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("availability_overrides")
      .select("id, target_date, override_type, start_time, end_time, reason")
      .eq("user_id", user.id)
      .gte("target_date", today)
      .order("target_date", { ascending: true })
      .abortSignal(request.signal);
    if (error) throw error;
    const rows = (data ?? []) as unknown as DbOverride[];
    return json({ data: rows.map(dbToUi) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const raw: unknown = await request.json().catch(() => null);
    const parsed = PostSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディが不正です",
      );
    }

    const dbType = parsed.data.override_type === "custom" ? "open" : "block";
    if (dbType === "open" && (!parsed.data.start_time || !parsed.data.end_time)) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "custom 例外は開始/終了時刻が必須です",
      );
    }
    if (
      dbType === "open" &&
      parsed.data.end_time! <= parsed.data.start_time!
    ) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "終了時刻は開始時刻より後にしてください",
      );
    }

    const { data, error } = await supabase
      .from("availability_overrides")
      .insert({
        user_id: user.id,
        target_date: parsed.data.target_date,
        override_type: dbType,
        start_time: dbType === "open" ? parsed.data.start_time! : null,
        end_time: dbType === "open" ? parsed.data.end_time! : null,
        reason: parsed.data.label ?? null,
      })
      .select("id, target_date, override_type, start_time, end_time, reason")
      .single();
    if (error) throw error;
    return json({ data: dbToUi(data as unknown as DbOverride) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
