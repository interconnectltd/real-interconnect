/**
 * GET /api/v1/calendar/feed-token — ICS フィード token (未実装スタブ)
 *
 * ICS 配信機能は未実装。token 列を持つテーブル / ローテーション API /
 * /api/v1/calendar/feed/[token] の ICS 出力 endpoint がいずれも未着手のため、
 * ここでは 200 + { data: { token: null } } を返して UI 側 (settings/page.tsx)
 * の `if (json.data?.token)` 分岐を黙らせる。404 で res.json() が壊れる症状の止血。
 *
 * TODO: 実装時は user_calendar_feed_tokens テーブル + RLS 追加 + ICS 配信 endpoint。
 */

import { withAuth, json, handleApiError } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    await withAuth(request);
    return json({ data: { token: null, supported: false } });
  } catch (error) {
    return handleApiError(error);
  }
}
