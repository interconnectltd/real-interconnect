/**
 * tl;dv → Supabase 同期をローカル / CI で実行 (Netlify route の認証バイパス版)。
 *
 * 実行:
 *   npx tsx scripts/run-tldv-sync.ts [maxMeetings]
 *
 * 必要 env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TLDV_API_KEY
 *
 * 任意:
 *   TLDV_INTERNAL_DOMAINS  (社内会議判定、カンマ区切り)
 *   TLDV_OPERATOR_EMAILS   (運営メンバー、カンマ区切り)
 *
 * 仕様:
 *   - listMeetings(page=1) で最新ミーティング取得
 *   - 引数 (or env TLDV_MAX_MEETINGS) で件数 cap (default 10)
 *   - holdForConsent=true で同意未取得の prospect 発話を一時保留
 *   - 既存 transcript はスキップ (idempotent)
 */

import { existsSync } from "fs";
import { resolve } from "path";

const envLocalPath = resolve(process.cwd(), ".env.local");

async function main() {
  if (existsSync(envLocalPath)) {
    const { config } = await import("dotenv");
    config({ path: envLocalPath });
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const tldvKey = (process.env.TLDV_API_KEY ?? "").trim();
  if (!url || !srk) throw new Error("Missing Supabase env");
  if (!tldvKey) throw new Error("Missing TLDV_API_KEY");
  // 401 デバッグ: key の長さ / prefix / 末尾を出す (Secret なので部分露出のみ)
  console.log("[debug] TLDV_API_KEY len:", tldvKey.length, "prefix:", tldvKey.slice(0, 6), "tail:", JSON.stringify(tldvKey.slice(-3)));
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = srk;
  process.env.TLDV_API_KEY = tldvKey;

  // 複数 endpoint / header で probe して 401 真因を特定
  const probes = [
    { url: "https://pasta.tldv.io/v1alpha1/meetings?page=1", header: "x-api-key", value: tldvKey },
    { url: "https://pasta.tldv.io/v1alpha1/meetings?page=1", header: "Authorization", value: `Bearer ${tldvKey}` },
    { url: "https://pasta.tldv.io/v1alpha1/meetings?page=1", header: "Authorization", value: `Api-Key ${tldvKey}` },
    { url: "https://api.tldv.io/v1/meetings?page=1", header: "x-api-key", value: tldvKey },
    { url: "https://api.tldv.io/v1/meetings?page=1", header: "Authorization", value: `Bearer ${tldvKey}` },
    { url: "https://api.tldv.io/v1alpha1/meetings?page=1", header: "x-api-key", value: tldvKey },
  ];
  for (const p of probes) {
    try {
      const r = await fetch(p.url, { headers: { [p.header]: p.value, "Content-Type": "application/json" } });
      const body = (await r.text()).slice(0, 100);
      console.log(`[probe] ${r.status} ${p.url} ${p.header}=${p.value.slice(0, 12)}... → ${body}`);
    } catch (e) {
      console.log(`[probe] ERR ${p.url} ${p.header}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const argMax = Number(process.argv[2] ?? process.env.TLDV_MAX_MEETINGS ?? 10);
  const maxMeetings = Math.max(1, Math.min(argMax, 50));

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, srk);

  const { createTldvClient, processTldvMeeting } = await import("../src/lib/tldv");
  const tldv = createTldvClient();

  const list = await tldv.listMeetings(1);
  const meetings = list.results.slice(0, maxMeetings);
  console.log(`[run-tldv-sync] tl;dv total=${list.total}, processing=${meetings.length}`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const meeting of meetings) {
    try {
      const r = await processTldvMeeting(meeting.id, sb, tldv, { holdForConsent: true });
      if (r.skipped) skipped++;
      else processed++;
    } catch (err) {
      failed++;
      console.error(`[run-tldv-sync] meeting ${meeting.id} failed:`, err instanceof Error ? err.message : String(err));
    }
  }
  console.log(`[run-tldv-sync] done processed=${processed} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
