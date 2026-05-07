/**
 * DELETE /api/v1/scheduling/overrides/[id] — 自分の override を 1 件削除
 *
 * RLS (auth_self_avail_overrides) により自分の行のみ削除可能。
 */

import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, supabase } = await withAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return jsonError(400, "BAD_REQUEST", "id が不正です");
    }

    const { error } = await supabase
      .from("availability_overrides")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    return json({ data: { deleted: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
