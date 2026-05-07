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
import { getClientIp } from "@/lib/client-ip";
import { enforceAnonRateLimit } from "@/lib/rate-limit-db";

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
    const ip = getClientIp(headersList);
    const ua = headersList.get("user-agent") ?? null;

    // Wave1 sec audit: rate limit 必須化 (IP & email 軸)
    //   IP: 1h 5 件 / email: 24h 5 件 (spam / SLA noise / mass urgent_removal 防止)
    const emailKey = parsed.data.sender_email.toLowerCase();
    const [okIp, okEmail] = await Promise.all([
      enforceAnonRateLimit({
        bucket: "contact:ip",
        identifier: ip ?? "unknown",
        limit: 5,
        windowSec: 3600,
        strict: true,
      }),
      enforceAnonRateLimit({
        bucket: "contact:email",
        identifier: emailKey,
        limit: 5,
        windowSec: 86_400,
        strict: false,
      }),
    ]);
    if (!okIp || !okEmail) {
      return jsonError(
        429,
        "RATE_LIMITED",
        "短時間に大量の送信が確認されました。しばらく時間をおいてからお試しください",
      );
    }

    // SLA 設定:
    //   urgent_removal       = 4h     (緊急削除、名誉毀損コンテンツ等の即時対応)
    //   data_disclosure      = 30 日  (個情法 27 条 — 本人開示請求の法定上限)
    //   data_deletion        = 30 日  (個情法 27 条 — 削除請求)
    //   tokushoho            = 30 日  (特商法 11 条 — 開示請求)
    //   その他 (general 等)  = 24h
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    let slaMs: number;
    if (parsed.data.kind === "urgent_removal") {
      slaMs = 4 * HOUR;
    } else if (
      parsed.data.kind === "data_disclosure" ||
      parsed.data.kind === "data_deletion" ||
      parsed.data.kind === "tokushoho"
    ) {
      slaMs = 30 * DAY;
    } else {
      slaMs = 24 * HOUR;
    }
    const sla = new Date(Date.now() + slaMs);

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
