/**
 * GET   /api/v1/admin/import-requests/[id]/meetings
 *   申請ユーザーに紐付け候補となる会議リストを返す。
 *   - meeting_transcripts (status=ready/analyzed) を取得
 *   - 各会議に登場する meeting_participants の speaker_name 一覧を含める
 *   - 既にこのユーザーに紐付け済の participant 行があればフラグで返す
 *
 * POST /api/v1/admin/import-requests/[id]/meetings
 *   body: { meetings: Array<{ transcript_id: string, speaker_name: string }> }
 *   選んだ会議 (transcript_id) で speaker_name 一致の participants.user_id を申請ユーザーに back-fill。
 *   既存 user_id があれば上書きしない (誤紐付け防止)。
 *   audit_logs に admin.import_request.link_meetings 記録。
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

export const dynamic = "force-dynamic";

const PostSchema = z.object({
  meetings: z
    .array(
      z.object({
        transcript_id: z.string().uuid(),
        speaker_name: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(100),
  /** 既に他ユーザーに紐付け済の participant も上書きするか (誤紐付けの修正用) */
  force: z.boolean().default(false),
});

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }
    const { supabase } = await withAdminAuth(request);

    // 申請の取得 (申請ユーザー id 確認)
    const { data: req, error: reqErr } = await supabase
      .from("meeting_data_import_requests")
      .select("id, user_id, status")
      .eq("id", id)
      .maybeSingle();
    if (reqErr) {
      console.error("[admin/import-requests/[id]/meetings] req fetch failed:", reqErr);
      return jsonError(500, "INTERNAL_ERROR", `request fetch failed: ${reqErr.message ?? reqErr.code ?? "unknown"}`);
    }
    if (!req) return jsonError(404, "NOT_FOUND", "申請が見つかりません");

    // 申請ユーザーの profile (name 比較用)
    const { data: profile, error: profErr } = await supabase
      .from("user_profiles")
      .select("id, name, email")
      .eq("id", req.user_id)
      .maybeSingle();
    if (profErr) {
      console.error("[admin/import-requests/[id]/meetings] profile fetch failed:", profErr);
    }

    // 全会議 (recent 100 件) — テーブル不在 / RLS 拒否でも 500 にせず空配列にフォールバック
    let transcripts: Array<{ id: string; title: string | null; meeting_date: string | null; status: string; created_at: string }> = [];
    let transcriptsError: string | null = null;
    {
      const { data, error } = await supabase
        .from("meeting_transcripts")
        .select("id, title, meeting_date, status, created_at")
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        console.error("[admin/import-requests/[id]/meetings] transcripts fetch failed:", error);
        transcriptsError = `${error.code ?? ""}: ${error.message ?? "unknown"}`.trim();
      } else {
        transcripts = (data ?? []) as typeof transcripts;
      }
    }

    const transcriptIds = transcripts.map((t) => t.id);

    // 各会議の participants (transcript_id IN 一括取得)
    let participants: Array<{ id: string; transcript_id: string; speaker_name: string | null; email: string | null; user_id: string | null; is_linked: boolean | null }> = [];
    let participantsError: string | null = null;
    if (transcriptIds.length) {
      const { data, error } = await supabase
        .from("meeting_participants")
        .select("id, transcript_id, speaker_name, email, user_id, is_linked")
        .in("transcript_id", transcriptIds);
      if (error) {
        console.error("[admin/import-requests/[id]/meetings] participants fetch failed:", error);
        participantsError = `${error.code ?? ""}: ${error.message ?? "unknown"}`.trim();
      } else {
        participants = (data ?? []) as typeof participants;
      }
    }

    // transcript_id ごとに participants をまとめる
    const grouped = new Map<string, typeof participants>();
    for (const p of participants) {
      const arr = grouped.get(p.transcript_id) ?? [];
      arr.push(p);
      grouped.set(p.transcript_id, arr);
    }

    const profileName = profile?.name?.trim().toLowerCase() ?? "";
    const profileEmail = profile?.email?.trim().toLowerCase() ?? "";

    // 全会議を返す (admin が participant 単位で選べるように candidates も all_participants も両方)
    const meetings = transcripts.map((t) => {
      const ps = grouped.get(t.id) ?? [];
      const linkedToThisUser = ps.some((p) => p.user_id === req.user_id);
      const allParticipants = ps.map((p) => ({
        participant_id: p.id,
        speaker_name: p.speaker_name,
        email: p.email,
        already_linked_other: p.user_id !== null && p.user_id !== req.user_id,
        is_match:
          (profileName && (p.speaker_name ?? "").trim().toLowerCase().includes(profileName)) ||
          (profileEmail && (p.email ?? "").trim().toLowerCase() === profileEmail),
      }));
      const candidates = allParticipants.filter((p) => p.is_match);
      return {
        transcript_id: t.id,
        title: t.title,
        meeting_date: t.meeting_date,
        status: t.status,
        participants_count: ps.length,
        linked_to_this_user: linkedToThisUser,
        candidates,
        all_participants: allParticipants,
      };
    });

    return json({
      request: { id: req.id, user_id: req.user_id, status: req.status },
      profile: profile ?? null,
      meetings,
      // admin debug: テーブル不在 / RLS 拒否時にも何が起こったか露出 (admin only)
      _debug: {
        transcripts_error: transcriptsError,
        participants_error: participantsError,
        transcripts_count: transcripts.length,
        participants_count: participants.length,
      },
    });
  } catch (error) {
    console.error("[admin/import-requests/[id]/meetings] unhandled:", error);
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return jsonError(400, "BAD_REQUEST", "id (UUID) 必須");
    }
    const { user, supabase } = await withAdminAuth(request);

    const raw: unknown = await request.json().catch(() => null);
    const parsed = PostSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }

    // RPC で 1 SQL 完結 (idempotent + transactional + speaker_name は exact 一致)
    type RpcLoose = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const { data: rpcData, error: rpcErr } = await (
      supabase as unknown as RpcLoose
    ).rpc("link_import_request_meetings", {
      p_request_id: id,
      p_meetings: parsed.data.meetings,
      p_force: parsed.data.force,
    });
    if (rpcErr) {
      return jsonError(500, "DB_ERROR", rpcErr.message ?? "RPC failed");
    }

    const result = (rpcData ?? {}) as {
      participants_linked?: number;
      request_user_id?: string;
    };
    const linkedCount = result.participants_linked ?? 0;

    // 紐付け完了をユーザーへ in-app 通知 (notifications テーブル INSERT)
    if (linkedCount > 0 && result.request_user_id) {
      // notifications.type は enum (system / connection_request 等)。
      // import_request_progress は未定義のため system で代用、title/message で明示。
      void supabase.from("notifications").insert({
        user_id: result.request_user_id,
        type: "system",
        title: "会議データの取込が進みました",
        message: `${linkedCount} 件の会議参加情報をプロフィールに反映しました。マッチング精度が向上します。`,
        link: "/dashboard",
        is_read: false,
      } as never).then(({ error }) => {
        if (error) console.warn("[link-meetings] notification failed:", error.message);
      });
    }

    const client = extractClientInfo(request);
    void writeAuditLog(supabase, {
      actor_id: user.id,
      action: "admin.import_request.update",
      target_type: "import_request",
      target_id: id,
      payload: {
        op: "link_meetings",
        target_user_id: result.request_user_id ?? null,
        meetings_attempted: parsed.data.meetings.length,
        participants_linked: linkedCount,
        force: parsed.data.force,
      },
      ip: client.ip,
      ua: client.ua,
    });

    return json({
      participants_linked: linkedCount,
      meetings_attempted: parsed.data.meetings.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
