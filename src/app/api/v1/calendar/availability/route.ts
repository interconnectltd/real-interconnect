/**
 * GET    /api/v1/calendar/availability             - 自分の rules + overrides
 * POST   /api/v1/calendar/availability             - rule or override 追加
 * DELETE /api/v1/calendar/availability?id=...      - rule or override 削除
 *
 * Phase B: 営業時間と特定日例外を CRUD。
 */

import { z } from "zod";
import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

const CreateRuleSchema = z.object({
  kind: z.literal("rule"),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  is_active: z.boolean().optional(),
});

const CreateOverrideSchema = z.object({
  kind: z.literal("override"),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  override_type: z.enum(["block", "open"]),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  reason: z.string().max(200).optional(),
});

const CreateSchema = z.discriminatedUnion("kind", [
  CreateRuleSchema,
  CreateOverrideSchema,
]);

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const [{ data: rules }, { data: overrides }] = await Promise.all([
      supabase
        .from("availability_rules")
        .select("*")
        .eq("user_id", user.id)
        .abortSignal(request.signal),
      supabase
        .from("availability_overrides")
        .select("*")
        .eq("user_id", user.id)
        .gte("target_date", new Date().toISOString().slice(0, 10))
        .order("target_date", { ascending: true })
        .abortSignal(request.signal),
    ]);

    return json({
      rules: rules ?? [],
      overrides: overrides ?? [],
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const raw: unknown = await request.json().catch(() => null);
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }
    const data = parsed.data;

    if (data.kind === "rule") {
      const { data: row, error } = await supabase
        .from("availability_rules")
        .insert({
          user_id: user.id,
          day_of_week: data.day_of_week,
          start_time: data.start_time,
          end_time: data.end_time,
          is_active: data.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return json(row, 201);
    }
    // override
    if (data.override_type === "open" && (!data.start_time || !data.end_time)) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "open override は start_time と end_time が必須",
      );
    }
    const { data: row, error } = await supabase
      .from("availability_overrides")
      .insert({
        user_id: user.id,
        target_date: data.target_date,
        override_type: data.override_type,
        start_time: data.start_time ?? null,
        end_time: data.end_time ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return json(row, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const kind = url.searchParams.get("kind");
    if (!id || (kind !== "rule" && kind !== "override")) {
      return jsonError(400, "BAD_REQUEST", "id と kind=rule|override が必須");
    }

    const table =
      kind === "rule" ? "availability_rules" : "availability_overrides";
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    return json({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
