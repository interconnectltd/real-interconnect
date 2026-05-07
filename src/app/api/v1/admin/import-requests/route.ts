/**
 * GET   /api/v1/admin/import-requests          - 全申請一覧 (admin only)
 * PATCH /api/v1/admin/import-requests?id=...   - 状態変更 (admin only)
 *
 * admin = user_profiles.is_admin = true
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
  status: z.enum(["pending", "processing", "done", "rejected"]),
  admin_note: z.string().max(2000).optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAdminAuth(request);

    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    // カラム明示 (将来テーブル拡張で機微カラム追加された時の意図せぬ流出を防ぐ)
    let q = supabase
      .from("meeting_data_import_requests")
      .select(
        "id, user_id, status, message, source, admin_note, processed_at, processed_by, created_at, updated_at, user_profiles!meeting_data_import_requests_user_id_fkey(id, name, email, company)",
      )
      .order("created_at", { ascending: false })
      .abortSignal(request.signal);
    if (status) {
      q = q.eq("status", status as "pending" | "processing" | "done" | "rejected" | "cancelled");
    }

    const { data, error } = await q;
    if (error) throw error;

    // Bulk PII access 証跡 (Wave5 sec audit / 個情法 R5)
    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.import_request.list_view",
      target_type: "import_request",
      target_id: null,
      payload: { status: status || null, result_count: data?.length ?? 0 },
      ip: client.ip,
      ua: client.ua,
    });

    const res = json(data ?? []);
    res.headers.set("Cache-Control", "no-store, private");
    res.headers.set("Vary", "Cookie");
    return res;
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
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }
    // 却下時は admin_note 必須 (UI の Dialog 検証が fetch 直叩きで bypass されるのを防ぐ)
    if (
      parsed.data.status === "rejected" &&
      (!parsed.data.admin_note || parsed.data.admin_note.trim().length < 5)
    ) {
      return jsonError(
        400,
        "ADMIN_NOTE_REQUIRED",
        "却下するには理由 (5 字以上) が必要です",
      );
    }

    const update = {
      status: parsed.data.status,
      admin_note: parsed.data.admin_note ?? null,
      processed_at:
        parsed.data.status === "done" || parsed.data.status === "rejected"
          ? new Date().toISOString()
          : null,
      processed_by:
        parsed.data.status === "done" || parsed.data.status === "rejected"
          ? user.id
          : null,
    };

    // 既に done/rejected/cancelled 済の申請に対する重複 PATCH を弾く (通知重複防止)
    const { data, error } = await supabase
      .from("meeting_data_import_requests")
      .update(update)
      .eq("id", id)
      .not("status", "in", "(done,rejected,cancelled)")
      .select()
      .single();
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") {
        return jsonError(
          409,
          "CONFLICT",
          "既に最終状態の申請のため変更できません",
        );
      }
      throw error;
    }

    // ユーザー通知 (done/rejected の最終状態のみ)
    if (parsed.data.status === "done" || parsed.data.status === "rejected") {
      const userMessage =
        parsed.data.status === "done"
          ? "会議データの取込が完了しました。マッチング画面でご確認ください。"
          : `申請は却下されました${parsed.data.admin_note ? `: ${parsed.data.admin_note}` : "。"}`;
      void supabase.from("notifications").insert({
        user_id: data.user_id,
        type: "system",
        title:
          parsed.data.status === "done"
            ? "会議データ取込が完了しました"
            : "取込申請について",
        message: userMessage,
        link: "/dashboard",
        is_read: false,
      } as never).then(({ error: nerr }) => {
        if (nerr) console.warn("[import-requests PATCH] notification failed:", nerr.message);
      });
    }

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.import_request.update",
      target_type: "import_request",
      target_id: id,
      payload: { status: parsed.data.status, admin_note: parsed.data.admin_note ?? null },
      ip: client.ip,
      ua: client.ua,
    });

    return json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
