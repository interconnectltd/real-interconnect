/**
 * POST /api/v1/contact
 *
 * 公開フォームからお問い合わせを受付。anon でも投稿可能。
 * 認証済ユーザーは sender_user_id を紐付け。SLA 24h で計算。
 *
 * rate limit (Tier3): IP 別 + email 別で 1h 5 件まで等の上限を予定。
 * 本実装は zod 検証 + sanitize + DB INSERT のみ (CAPTCHA は別途)。
 */

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { json, jsonError, handleApiError } from "@/lib/api-helpers";

const KINDS = [
  "general",
  "support",
  "data_disclosure",
  "data_deletion",
  "tokushoho",
  "urgent_removal",
  "press",
  "partnership",
] as const;

const ContactSchema = z.object({
  sender_name: z.string().trim().min(1).max(100),
  sender_email: z.string().email().max(254),
  kind: z.enum(KINDS).default("general"),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(10).max(5000),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw: unknown = await request.json().catch(() => null);
    const parsed = ContactSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "ボディ不正",
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const headersList = await headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headersList.get("x-real-ip")?.trim() ??
      null;
    const ua = headersList.get("user-agent") ?? null;

    // 緊急削除 / 開示請求は SLA を 4h に短縮
    const sla =
      parsed.data.kind === "urgent_removal"
        ? new Date(Date.now() + 4 * 60 * 60 * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);

    // contact_messages は migration 00043 で新規追加されたため database.ts 型に
    // 未反映。`supabase gen types typescript` で再生成されるまで loose cast。
    type ContactInsert = {
      sender_name: string;
      sender_email: string;
      sender_user_id: string | null;
      kind: string;
      subject: string;
      body: string;
      ip_address: string | null;
      user_agent: string | null;
      sla_due_at: string;
    };
    type LooseTable = {
      insert: (
        v: ContactInsert,
      ) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: {
              id: string;
              kind: string;
              status: string;
              sla_due_at: string;
              created_at: string;
            } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
    const table = supabase.from("contact_messages") as unknown as LooseTable;
    const { data, error } = await table
      .insert({
        sender_name: parsed.data.sender_name,
        sender_email: parsed.data.sender_email.toLowerCase(),
        sender_user_id: user?.id ?? null,
        kind: parsed.data.kind,
        subject: parsed.data.subject,
        body: parsed.data.body,
        ip_address: ip,
        user_agent: ua,
        sla_due_at: sla.toISOString(),
      })
      .select("id, kind, status, sla_due_at, created_at")
      .single();

    if (error) throw error;
    if (!data) {
      return jsonError(500, "INSERT_FAILED", "お問い合わせの保存に失敗しました");
    }

    return json(
      {
        id: data.id,
        kind: data.kind,
        sla_due_at: data.sla_due_at,
        message: "お問い合わせを受け付けました。担当より追ってご連絡いたします。",
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
