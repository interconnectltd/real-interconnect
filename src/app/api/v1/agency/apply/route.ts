import { z } from "zod";
import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { writeAuditLog, extractClientInfo } from "@/lib/audit-log";
import { createServiceClient } from "@/lib/supabase/server";

const applyBodySchema = z.object({
  applicant_note: z.string().min(5).max(2000).optional(),
});

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const raw = await request.json().catch(() => ({}));
    const parsed = applyBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "applicant_note は 5-2000 字で指定してください",
      );
    }
    const { applicant_note } = parsed.data;

    const { data, error } = await supabase
      .from("agency_applications")
      .insert({
        applicant_id: user.id,
        applicant_note: applicant_note ?? null,
        status: "pending",
      })
      .select("id, status, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return jsonError(
          409,
          "ALREADY_PENDING",
          "既に申請中です。承認をお待ちください",
        );
      }
      console.warn("[agency.apply] insert failed:", error.message);
      return jsonError(500, "INSERT_FAILED", "申請の作成に失敗しました");
    }

    // agencies 行を pending で作成 (既存行があれば変更しない)
    const admin = await createServiceClient();
    await admin
      .from("agencies")
      .upsert(
        { user_id: user.id, status: "pending" },
        { onConflict: "user_id", ignoreDuplicates: true },
      );

    const { ip, ua } = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "agency.application.create",
      target_type: "agency_application",
      target_id: data.id,
      payload: { has_note: applicant_note != null },
      ip,
      ua,
    });

    return json(
      { id: data.id, status: data.status, created_at: data.created_at },
      201,
    );
  } catch (e) {
    return handleApiError(e);
  }
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    const { data, error } = await supabase
      .from("agency_applications")
      .select(
        "id, status, applicant_note, admin_note, reviewed_at, created_at, updated_at",
      )
      .eq("applicant_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[agency.apply.get] failed:", error.message);
      return jsonError(500, "FETCH_FAILED", "申請の取得に失敗しました");
    }

    return json({ application: data });
  } catch (e) {
    return handleApiError(e);
  }
}
