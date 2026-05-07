/**
 * GET  /api/v1/calendar/feed-token — 現在有効な ICS フィード token を返す (なければ null)
 * POST /api/v1/calendar/feed-token — token をローテーション (旧 token を revoke + 新 token 発行)
 *
 * 配信: /api/v1/calendar/feed/[token] が ICS を返す (00049 migration)。
 */

import {
  withAuth,
  json,
  jsonError,
  handleApiError,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface FeedTokenRow {
  id: string;
  token: string;
  created_at: string;
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    type LooseSelect = {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: unknown) => {
            is: (col: string, val: unknown) => {
              maybeSingle: () => Promise<{
                data: FeedTokenRow | null;
                error: { message?: string } | null;
              }>;
            };
          };
        };
      };
    };
    const { data, error } = await (supabase as unknown as LooseSelect)
      .from("user_calendar_feed_tokens")
      .select("id, token, created_at")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      return jsonError(500, "DB_ERROR", error.message ?? "fetch failed");
    }

    return json({
      data: {
        token: data?.token ?? null,
        created_at: data?.created_at ?? null,
        supported: true,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await withAuth(request);

    type RpcLoose = {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message?: string } | null }>;
    };
    const { data, error } = await (supabase as unknown as RpcLoose).rpc(
      "rotate_calendar_feed_token",
      {},
    );
    if (error) {
      return jsonError(500, "DB_ERROR", error.message ?? "rotate failed");
    }
    return json({ data: { token: data, supported: true } }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
