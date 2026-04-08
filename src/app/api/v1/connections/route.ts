import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    // Fetch connections where user is either side
    const { data, error } = await supabase
      .from("connections")
      .select("*")
      .or(`user_id.eq.${user.id},connected_user_id.eq.${user.id}`)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    if (!data) return json([]);

    // Filter by status if provided
    let filtered = data;
    if (status) {
      filtered = data.filter((c) => c.status === status);
    }

    // Collect all related user IDs and fetch profiles in one query
    const relatedIds = filtered.map((c) =>
      c.user_id === user.id ? c.connected_user_id : c.user_id,
    );
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, name, company, position, industry, avatar_url")
      .in("id", relatedIds);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

    const enriched = filtered.map((c) => ({
      ...c,
      profile: profileMap.get(
        c.user_id === user.id ? c.connected_user_id : c.user_id,
      ) ?? null,
    }));

    return json(enriched);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth();
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return jsonError(400, "BAD_REQUEST", "リクエストボディが不正です");
    }

    const { connected_user_id } = body;

    if (!connected_user_id || !isValidUUID(connected_user_id)) {
      return jsonError(400, "BAD_REQUEST", "有効なユーザーIDが必要です");
    }

    if (connected_user_id === user.id) {
      return jsonError(400, "BAD_REQUEST", "自分自身には接続申請できません");
    }

    // 対象ユーザー存在チェック (Fix #7)
    const { data: targetUser } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("id", connected_user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!targetUser) {
      return jsonError(404, "NOT_FOUND", "対象のユーザーが見つかりません");
    }

    // Check for existing connection — 双方向チェック (user.id is from auth — safe)
    const { data: existing } = await supabase
      .from("connections")
      .select("id, status")
      .or(
        `and(user_id.eq.${user.id},connected_user_id.eq.${connected_user_id}),and(user_id.eq.${connected_user_id},connected_user_id.eq.${user.id})`,
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === "pending" || existing.status === "accepted") {
        return jsonError(409, "CONFLICT", "既に接続申請済みまたは接続済みです");
      }
      if (existing.status === "blocked") {
        return jsonError(403, "FORBIDDEN", "この操作は実行できません");
      }
    }

    const { data, error } = await supabase
      .from("connections")
      .insert({ user_id: user.id, connected_user_id })
      .select()
      .single();

    if (error) throw error;

    // Create notification via service role (RLS blocks cross-user insert)
    const serviceClient = await createServiceClient();
    await serviceClient.from("notifications").insert({
      user_id: connected_user_id,
      type: "connection_request",
      title: "コネクション申請",
      message: "新しいコネクション申請があります",
      link: "/connections",
      actions: [
        { type: "accept", label: "承認する", payload: { connectionId: data.id } },
        { type: "reject", label: "お断りする", payload: { connectionId: data.id } },
      ],
    });

    return json(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
