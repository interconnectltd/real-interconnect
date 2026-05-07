/**
 * POST /api/v1/contact
 *
 * 公開フォームからお問い合わせを受付。anon でも投稿可能。
 * 認証済ユーザーは sender_user_id を紐付け。SLA は kind に応じ計算。
 *
 * Wave1: IP 軸 5/h + email 軸 5/24h DB rate-limit、getClientIp で IP 詐称遮断。
 * Wave2: CSRF Origin guard、honeypot/timing 検査、制御文字 / BiDi reject、
 *        zod エラー文言の汎化。
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

// 制御文字 (0x00-0x1F, 0x7F) + BiDi override (U+202A-U+202E, U+2066-U+2069) を拒否。
// admin UI での表示崩し / log injection 防止 (Wave2 sec audit Low-3)。
const NO_CTRL = /^[^\x00-\x1f\x7f‪-‮⁦-⁩]+$/;

const ContactSchema = z.object({
  sender_name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(NO_CTRL, "制御文字は使用できません"),
  sender_email: z.string().email().max(254),
  kind: z.enum(KINDS).default("general"),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(NO_CTRL, "制御文字は使用できません"),
  body: z.string().trim().min(10).max(5000),
  // anti-spam fields (Wave2 sec audit)
  hp_company: z.string().max(0).optional().default(""),
  ts_render: z.number().int().nonnegative().optional().default(0),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // CSRF Origin guard (anon endpoint なので明示的に呼ぶ)
    const origin = request.headers.get("origin");
    const allowedHosts = new Set(
      (process.env.ALLOWED_ORIGIN_HOSTS ?? "inter-connect.app,www.inter-connect.app")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (origin) {
      try {
        const u = new URL(origin);
        const isLocalhost =
          process.env.NODE_ENV !== "production" &&
          (u.hostname === "localhost" || u.hostname === "127.0.0.1");
        const isNetlifyPreview =
          (process.env.ALLOW_NETLIFY_PREVIEW ?? "").toLowerCase() === "true" &&
          u.hostname.endsWith(".netlify.app");
        if (!allowedHosts.has(u.hostname) && !isLocalhost && !isNetlifyPreview) {
          return jsonError(403, "FORBIDDEN", "オリジン不正");
        }
      } catch {
        return jsonError(403, "FORBIDDEN", "オリジン不正");
      }
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = ContactSchema.safeParse(raw);
    if (!parsed.success) {
      // 文言は汎化 (zod schema 内部詳細を漏らさない)
      return jsonError(
        400,
        "BAD_REQUEST",
        "入力内容に不備があります。各項目をご確認ください。",
      );
    }

    // bot 防御: honeypot or 描画から 2 秒未満で送信は silent drop
    // (200 を返して bot に学習機会を与えない)
    const elapsed = parsed.data.ts_render
      ? Date.now() - parsed.data.ts_render
      : Number.POSITIVE_INFINITY;
    if (
      (parsed.data.hp_company ?? "").length > 0 ||
      (parsed.data.ts_render && elapsed < 2000) ||
      (parsed.data.ts_render && elapsed > 6 * 3600_000)
    ) {
      return json(
        {
          id: "ok",
          kind: parsed.data.kind,
          sla_due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
          message: "お問い合わせを受け付けました。担当より追ってご連絡いたします。",
        },
        201,
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
    //   data_disclosure      = 30 日  (個情法 33 条 本人開示 — 法定上限)
    //   data_deletion        = 30 日  (個情法 35 条 利用停止 — 法定上限)
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
