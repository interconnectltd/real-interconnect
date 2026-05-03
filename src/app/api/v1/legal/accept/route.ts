import { json, jsonError, handleApiError } from "@/lib/api-helpers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { LEGAL_VERSIONS, type LegalDocKind } from "@/lib/legal/versions";

const KINDS: LegalDocKind[] = ["terms", "privacy", "tokushoho"];

/**
 * POST /api/v1/legal/accept
 * 同意ログをuser_terms_acceptancesに記録する。
 * クライアントは登録直後（auth.signUp成功直後）にこれを呼び出す。
 *
 * 認証済みユーザーが自分自身の同意を記録するエンドポイント。
 * IPとUAはサーバー側headersから取得し、クライアントの自己申告ではない値を保存する。
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError(401, "UNAUTHORIZED", "認証が必要です");
    }

    const headersList = await headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headersList.get("x-real-ip")?.trim() ??
      null;
    const userAgent = headersList.get("user-agent") ?? null;

    const service = await createServiceClient();
    const rows = KINDS.map((kind) => ({
      user_id: user.id,
      kind,
      version: LEGAL_VERSIONS[kind],
      ip_address: ip,
      user_agent: userAgent,
    }));

    const { error: insertError } = await service
      .from("user_terms_acceptances")
      .upsert(rows, {
        onConflict: "user_id,kind,version",
        ignoreDuplicates: true,
      });

    if (insertError) {
      console.error("legal/accept insert failed", insertError);
      return jsonError(500, "INSERT_FAILED", "同意の記録に失敗しました");
    }

    return json({ accepted: KINDS.length, versions: LEGAL_VERSIONS });
  } catch (error) {
    return handleApiError(error);
  }
}
