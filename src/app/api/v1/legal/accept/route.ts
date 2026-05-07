import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { LEGAL_VERSIONS, type LegalDocKind } from "@/lib/legal/versions";
import { getClientIp } from "@/lib/client-ip";

const KINDS: LegalDocKind[] = ["terms", "privacy", "tokushoho", "ai_cross_border"];

/**
 * POST /api/v1/legal/accept
 * 同意ログを user_terms_acceptances に記録する。
 *
 * 認証済みユーザーが自分自身の同意を記録するエンドポイント。
 * IP / UA はサーバー側 headers から取得し、クライアント自己申告ではない値を保存する。
 *
 * Body 必須: { terms: true, privacy: true, tokushoho: true, ai_cross_border: true }
 *   - 4 kind 全てが true でなければ 400 を返す (法的証跡の偽装防止)
 *   - body 省略 / 不足の旧仕様は撤廃 (Sec audit Critical 対応 / 2026-05-07)
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

    // Body 必須化: 4 kind 全 true でなければ 400
    const parsed = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      return jsonError(
        400,
        "BODY_REQUIRED",
        "同意内容 (terms / privacy / tokushoho / ai_cross_border) を body で送信してください",
      );
    }
    const bodyConsents = parsed as Partial<Record<LegalDocKind, boolean>>;
    const missing = KINDS.filter((k) => bodyConsents[k] !== true);
    if (missing.length > 0) {
      return jsonError(
        400,
        "INSUFFICIENT_CONSENT",
        `以下の同意が必要です: ${missing.join(", ")}`,
      );
    }

    const headersList = await headers();
    // Wave1 sec audit: x-forwarded-for[0] 信用は IP 詐称容易。Netlify は
    // x-nf-client-connection-ip / cf-connecting-ip / true-client-ip を信頼可。
    const ip = getClientIp(headersList);
    const userAgent = headersList.get("user-agent") ?? null;

    type AcceptanceRow = {
      user_id: string;
      kind: LegalDocKind;
      version: string;
      ip_address: string | null;
      user_agent: string | null;
      email_at_acceptance: string | null;
    };

    const service = await createServiceClient();
    const rows: AcceptanceRow[] = KINDS.map((kind) => ({
      user_id: user.id,
      kind,
      version: LEGAL_VERSIONS[kind],
      ip_address: ip,
      user_agent: userAgent,
      email_at_acceptance: user.email ?? null,
    }));

    // user_terms_acceptances was added in migration 00006 after Database types
    // were generated. Bypass the narrowed `never` typing until types are
    // regenerated (`supabase gen types typescript`).
    type UpsertResult = { error: unknown };
    type LooseTable = {
      upsert: (
        rows: AcceptanceRow[],
        options: { onConflict: string; ignoreDuplicates: boolean },
      ) => Promise<UpsertResult>;
    };
    const table = service.from("user_terms_acceptances") as unknown as LooseTable;
    const { error: insertError } = await table.upsert(rows, {
      onConflict: "user_id,kind,version",
      ignoreDuplicates: true,
    });

    if (insertError) {
      console.error("legal/accept insert failed", insertError);
      return jsonError(500, "INSERT_FAILED", "同意の記録に失敗しました");
    }

    // 同意完了で pending_consent transcripts を ready 昇格 + analyze ジョブ投入
    // 通常signUpユーザーには no-op (該当transcriptがないため)。
    // prospect招待ユーザーで同意完了したケースにだけ effect が出る。
    type RpcLoose = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    };
    const promote = await (service as unknown as RpcLoose).rpc(
      "promote_pending_consent_for_user",
      { p_user_id: user.id },
    );
    if (promote.error) {
      console.warn("[legal/accept] promote_pending_consent_for_user failed", promote.error);
      // 致命ではないため fall through (招待データなし or 既処理の通常ユーザー)
    }

    return json({
      accepted: KINDS.length,
      versions: LEGAL_VERSIONS,
      promoted: typeof promote.data === "number" ? promote.data : 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
