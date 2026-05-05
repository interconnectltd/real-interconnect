/**
 * 全 active user に対して Haiku 判定を順次実行 (cron 用)。
 * 各 viewer × 他全員 (top 50) を judge_pair_cache に埋める。
 *
 * 1 user / 日 100 ペア cap で運用 → 全員 judge し終えるのに数日かかる設計。
 * cron: 毎日 03:00 JST に走らせる。
 */

import { existsSync } from "fs";
import { resolve } from "path";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  const { config } = await import("dotenv");
  config({ path: envLocalPath });
}
if (!process.env.ANTHROPIC_API_KEY && process.env.AI_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.AI_API_KEY;
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const ak = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!url || !srk) throw new Error("Missing Supabase env");
  if (!ak) throw new Error("Missing ANTHROPIC_API_KEY");
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = srk;
  process.env.ANTHROPIC_API_KEY = ak;

  const sb = createClient(url, srk);

  const { data: viewerRows } = await sb
    .from("user_conversation_vectors")
    .select("user_id")
    .order("analysis_count", { ascending: false });
  const viewers = ((viewerRows ?? []) as { user_id: string }[]).map((r) => r.user_id);

  console.log(`[run-judge-all] processing ${viewers.length} viewers`);

  const { handleJudgePairBatch } = await import("../worker/src/handlers/judge");

  let ok = 0;
  let fail = 0;
  for (const viewerId of viewers) {
    try {
      const { data: targets } = await sb
        .from("user_profiles")
        .select("id")
        .eq("is_active", true)
        .neq("id", viewerId)
        .limit(50);
      const targetIds = ((targets ?? []) as { id: string }[]).map((t) => t.id);
      if (targetIds.length === 0) continue;

      console.log(`[run-judge-all] viewer=${viewerId} targets=${targetIds.length}`);
      await handleJudgePairBatch({ viewer_id: viewerId, target_ids: targetIds, top_n: 50 });
      ok++;
    } catch (err) {
      fail++;
      console.error(`[run-judge-all] viewer=${viewerId} FAILED:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[run-judge-all] done ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error("[run-judge-all] FATAL:", err);
  process.exit(1);
});
