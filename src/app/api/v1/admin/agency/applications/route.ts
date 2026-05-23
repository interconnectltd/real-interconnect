import { withAdminAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const { adminSupabase } = await withAdminAuth(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "pending";

    let query = adminSupabase
      .from("agency_applications")
      .select(
        "id, applicant_id, status, applicant_note, admin_note, reviewed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (status !== "all") {
      if (
        status !== "pending" &&
        status !== "approved" &&
        status !== "rejected"
      ) {
        return jsonError(400, "BAD_REQUEST", "status の値が不正です");
      }
      query = query.eq("status", status);
    }

    const { data: apps, error } = await query;
    if (error) {
      console.warn("[admin.agency.applications] failed:", error.message);
      return jsonError(500, "FETCH_FAILED", "申請の取得に失敗しました");
    }

    const applicantIds = Array.from(
      new Set((apps ?? []).map((a) => a.applicant_id)),
    );
    const { data: users } = await adminSupabase
      .from("user_profiles")
      .select("id, name, email, company, avatar_url")
      .in(
        "id",
        applicantIds.length > 0
          ? applicantIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
    const userMap = new Map((users ?? []).map((u) => [u.id, u]));

    const enriched = (apps ?? []).map((a) => ({
      id: a.id,
      status: a.status,
      applicant_note: a.applicant_note,
      admin_note: a.admin_note,
      reviewed_at: a.reviewed_at,
      created_at: a.created_at,
      applicant: userMap.get(a.applicant_id) ?? null,
    }));

    return json({ applications: enriched });
  } catch (e) {
    return handleApiError(e);
  }
}
