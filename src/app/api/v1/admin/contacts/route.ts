/**
 * GET   /api/v1/admin/contacts        - 一覧 (status filter / SLA 超過先頭)
 * PATCH /api/v1/admin/contacts?id=... - 状態更新 / 担当者割当
 */

import { z } from "zod";
import {
  withAdminAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";

const PatchSchema = z.object({
  status: z.enum([
    "new",
    "assigned",
    "in_progress",
    "awaiting_user",
    "resolved",
    "rejected",
  ]).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await withAdminAuth(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    let q = supabase
      .from("contact_messages")
      .select(
        "id, sender_name, sender_email, sender_user_id, kind, subject, body, status, assignee_id, sla_due_at, resolved_at, created_at, updated_at",
      )
      .order("status", { ascending: true })
      .order("sla_due_at", { ascending: true })
      .limit(200);
    if (status) {
      q = q.eq(
        "status",
        status as "new" | "assigned" | "in_progress" | "awaiting_user" | "resolved" | "rejected",
      );
    }

    const { data, error } = await q;
    if (error) throw error;
    return json(data ?? []);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await withAdminAuth(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id || !isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "ボディ不正");
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) {
      update.status = parsed.data.status;
      if (parsed.data.status === "resolved" || parsed.data.status === "rejected") {
        update.resolved_at = new Date().toISOString();
      }
    }
    if (parsed.data.assignee_id !== undefined) {
      update.assignee_id = parsed.data.assignee_id;
    }

    // contact_messages は migration 00043 で追加 (database.ts 未反映) のため loose cast
    type LooseTable = {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          select: () => {
            single: () => Promise<{
              data: Record<string, unknown> | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
    const table = supabase.from("contact_messages") as unknown as LooseTable;
    const { data, error } = await table
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.contact.update",
      target_type: "contact_message",
      target_id: id,
      payload: update,
      ip: client.ip,
      ua: client.ua,
    });

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
