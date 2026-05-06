/**
 * GET /api/v1/notifications/[id]/context
 *
 * 通知に紐づく文脈情報を一括取得する endpoint.
 * - コネクション申請通知の場合: 申請者プロフィール + マッチ理由 + スコア + 申請日時
 *
 * 通知 UI に「相手が誰で、なぜマッチしたのか」を表示するために使う。
 * 旧 UI は title/message 文字列だけで承認可否の判断材料が不足していた。
 *
 * 認可: 通知の所有者 (user_id = auth.uid()) 本人のみ。
 */

import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidUUID } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

interface NotifAction {
  type?: string;
  payload?: { connectionId?: string; userId?: string };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }
    const { user, supabase } = await withAuth(request);

    // 通知本体 (所有者チェックは RLS でも掛かるが明示)
    const { data: notif, error: nErr } = await supabase
      .from("notifications")
      .select("id, user_id, type, title, message, link, actions, is_read, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (nErr) throw nErr;
    if (!notif) {
      return jsonError(404, "NOT_FOUND", "通知が見つかりません");
    }

    // actions から connectionId / userId を抽出
    const actions = (Array.isArray(notif.actions) ? notif.actions : []) as NotifAction[];
    const connectionId = actions.find((a) => a.payload?.connectionId)?.payload
      ?.connectionId;
    let requesterId =
      actions.find((a) => a.payload?.userId)?.payload?.userId ?? null;

    // connection 経由で requester を解決
    let connectionInfo: {
      id: string;
      status: string;
      created_at: string;
      requester_id: string;
    } | null = null;

    if (connectionId && isValidUUID(connectionId)) {
      const { data: conn } = await supabase
        .from("connections")
        .select("id, status, created_at, user_id, connected_user_id")
        .eq("id", connectionId)
        .maybeSingle();
      if (conn) {
        // 申請者: 自分が connected_user_id なら user_id 側、逆なら connected_user_id
        const reqId =
          conn.connected_user_id === user.id ? conn.user_id : conn.connected_user_id;
        connectionInfo = {
          id: conn.id,
          status: conn.status,
          created_at: conn.created_at,
          requester_id: reqId,
        };
        if (!requesterId) requesterId = reqId;
      }
    }

    if (!requesterId || !isValidUUID(requesterId)) {
      // コネクション申請以外の通知や requester 解決不能の場合は通知本体のみ返す
      return json({
        notification: notif,
        connection: connectionInfo,
        profile: null,
        match: null,
      });
    }

    // 申請者プロフィール + マッチスコア (viewer=自分, target=申請者) を並列取得
    const [profileRes, matchRes] = await Promise.all([
      supabase
        .from("user_profiles")
        .select(
          "id, name, avatar_url, company, position, industry, bio",
        )
        .eq("id", requesterId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("matching_scores_v4")
        .select("total_score, reasons, phase, confidence, calculated_at")
        .eq("viewer_id", user.id)
        .eq("target_id", requesterId)
        .maybeSingle(),
    ]);

    return json({
      notification: notif,
      connection: connectionInfo,
      profile: profileRes.data ?? null,
      match: matchRes.data ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
