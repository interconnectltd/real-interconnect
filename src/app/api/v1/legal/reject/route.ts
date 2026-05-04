import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

/**
 * POST /api/v1/legal/reject
 *
 * Prospect招待ユーザーが同意を拒否した場合の完全削除エンドポイント。
 * 同意ゲート画面 (/onboarding/consent) の「DELETE 文字列タイプ確認」を経て呼ばれる。
 *
 * Body: { confirmation: "DELETE" } 必須
 *
 * セキュリティ:
 *   - 認証必須 (auth.getUser)
 *   - body.confirmation === "DELETE" 必須
 *   - prospect_invite_at IS NOT NULL かつ user_terms_acceptances 不在 の場合のみ実行
 *     (一般ユーザーの誤呼出による暴発を防ぐ。RPC内でも再ガード)
 *
 * 動作:
 *   1. body 検証 + prospect ガード
 *   2. bulk_invite_log に reject metadata (IP/UA/timestamp) を記録
 *   3. reject_prospect_invite RPC で:
 *      - pending_consent transcripts の参加者発話 REDACT
 *      - participant 紐付け解除 (全status)
 *      - bulk_invite_log を 'revoked' に
 *      - auth.users 削除 (BEFORE DELETE trigger で user_terms_acceptances を email snapshot保全)
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError(401, "UNAUTHORIZED", "認証が必要です");
    }

    // body 検証
    const body = (await request.json().catch(() => null)) as
      | { confirmation?: string }
      | null;
    if (!body || body.confirmation !== "DELETE") {
      return jsonError(
        400,
        "CONFIRMATION_REQUIRED",
        '削除確認のため body に { "confirmation": "DELETE" } が必要です',
      );
    }

    const service = await createServiceClient();

    // prospect ガード (server側でも再確認、SQL関数とは別レイヤ)
    const { data: profile } = await (
      service.from("user_profiles") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: { prospect_invite_at: string | null } | null;
              error: unknown;
            }>;
          };
        };
      }
    )
      .select("prospect_invite_at")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || !profile.prospect_invite_at) {
      return jsonError(
        403,
        "NOT_A_PROSPECT",
        "このエンドポイントは招待経由ユーザーのみ利用可能です",
      );
    }

    // reject 操作の証跡を bulk_invite_log.metadata に追記
    const headersList = await headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headersList.get("x-real-ip")?.trim() ??
      null;
    const userAgent = headersList.get("user-agent") ?? null;

    // 既存 metadata を保持しつつ reject 情報を merge。
    // 同一ユーザーで複数の bulk_invite_log 行が存在しうる(過去 revoked → 再 invite 等)ため、
    // status='invited' AND user_id=X の最新行(=00012で部分uniqueにより1行)に対してmerge。
    type LogTable = {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{
                  data: { id: string; metadata: unknown } | null;
                  error: unknown;
                }>;
              };
            };
          };
        };
      };
      update: (vals: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message?: string } | null }>;
      };
    };
    const { data: existing } = await (
      service.from("bulk_invite_log") as unknown as LogTable
    )
      .select("id, metadata")
      .eq("user_id", user.id)
      .eq("status", "invited")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const existingMeta =
      typeof existing?.metadata === "object" && existing?.metadata !== null
        ? (existing.metadata as Record<string, unknown>)
        : {};
    if (existing?.id) {
      await (service.from("bulk_invite_log") as unknown as LogTable)
        .update({
          metadata: {
            ...existingMeta,
            rejected_at: new Date().toISOString(),
            rejected_ip: ip,
            rejected_user_agent: userAgent,
          },
        })
        .eq("id", existing.id);
    }

    // RPC 実行
    type RpcLoose = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const { error: rpcError } = await (service as unknown as RpcLoose).rpc(
      "reject_prospect_invite",
      { p_user_id: user.id },
    );

    if (rpcError) {
      console.error("[legal/reject] reject_prospect_invite failed", rpcError);
      return jsonError(500, "REJECT_FAILED", "アカウント削除に失敗しました");
    }

    // セッション失効: @supabase/ssr が使う cookie 名は sb-<projectRef>-auth-token (.0/.1 分割)。
    // signOut() でサーバ側のCookieクリアを正しく行う。
    await supabase.auth.signOut();
    return json({ rejected: true });
  } catch (error) {
    return handleApiError(error);
  }
}
