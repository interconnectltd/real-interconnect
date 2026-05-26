import { withAuth, json, handleApiError } from "@/lib/api-helpers";
import { extractClientInfo } from "@/lib/audit-log";
import { parseUserAgent } from "@/lib/ua-parse";

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { ip, ua } = extractClientInfo(request);
    const { device, browser, os } = parseUserAgent(ua);
    const referrer = request.headers.get("referer") ?? null;

    await supabase.from("login_sessions").insert({
      user_id: user.id,
      ip_address: ip,
      user_agent: ua,
      device,
      browser,
      os,
      referrer,
    });

    return json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
