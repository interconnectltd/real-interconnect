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

    // SLA 超過先頭表示: 旧版の status alphabet sort では new が awaiting_user 下に
    // 沈む問題があった → SLA 期限早い順 (超過 = 先頭) に変更。
    // status 未指定時は resolved/rejected を除外 (運営は別タブ確認に統一)。
    let q = supabase
      .from("contact_messages")
      .select(
        "id, sender_name, sender_email, sender_user_id, kind, subject, body, status, assignee_id, sla_due_at, resolved_at, created_at, updated_at",
      )
      .order("sla_due_at", { ascending: true })
      .limit(200);
    if (status === "all") {
      // 明示的「すべて」指定 → 何もフィルタしない
    } else if (status) {
      q = q.eq(
        "status",
        status as "new" | "assigned" | "in_progress" | "awaiting_user" | "resolved" | "rejected",
      );
    } else {
      q = q.not("status", "in", "(resolved,rejected)");
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
      // 担当者は admin かつ active のみ許可 (任意 UUID で非 admin / 退会済を入れる
      // 攻撃を防ぐ)。null は担当解除なので素通り。
      if (parsed.data.assignee_id !== null) {
        const { data: candidate } = await supabase
          .from("user_profiles")
          .select("id, is_admin, is_active")
          .eq("id", parsed.data.assignee_id)
          .maybeSingle();
        if (!candidate || !candidate.is_admin || !candidate.is_active) {
          return jsonError(
            422,
            "INVALID_ASSIGNEE",
            "担当者は active な admin ユーザーのみ指定できます",
          );
        }
      }
      update.assignee_id = parsed.data.assignee_id;
    }

    // contact_messages は migration 00043 で追加 (database.ts 未反映) のため loose cast
    // 状態遷移 race 防止: resolved/rejected の最終状態に対する更新は拒否 (CAS 風)。
    type LooseTable = {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          not: (col: string, op: string, val: string) => {
            select: () => {
              single: () => Promise<{
                data: Record<string, unknown> | null;
                error: { message?: string; code?: string } | null;
              }>;
            };
          };
        };
      };
    };
    const table = supabase.from("contact_messages") as unknown as LooseTable;
    const { data, error } = await table
      .update(update)
      .eq("id", id)
      .not("status", "in", "(resolved,rejected)")
      .select()
      .single();
    if (error) {
      if (error.code === "PGRST116") {
        return jsonError(
          409,
          "CONFLICT",
          "既に最終状態の問い合わせは変更できません",
        );
      }
      throw error;
    }

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
