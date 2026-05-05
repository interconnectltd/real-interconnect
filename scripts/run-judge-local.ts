/**
 * Haiku 判定をローカル / CI で実行 (Render deploy 不要)。
 * worker/src/handlers/judge.ts の handleJudgePairBatch を直接呼び、
 * 本番 Supabase の judge_pair_cache を埋める。
 *
 * 実行:
 *   ローカル: npx tsx scripts/run-judge-local.ts [viewer_id]
 *   CI (GH Actions): env を Secrets から渡す + viewer_id 引数 or VIEWER_ID env
 *
 * 必要 env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY (or AI_API_KEY)
 *
 * 引数 (任意):
 *   $1: 特定 viewer_id を指定。省略時は最も active な user を auto 選択
 */

import { existsSync } from "fs";
import { resolve } from "path";

// ローカル実行時のみ .env.local を読む。CI では Secrets が直接 env に入る。
const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  const { config } = await import("dotenv");
  config({ path: envLocalPath });
}

// AI_API_KEY → ANTHROPIC_API_KEY エイリアス (worker/judge.ts は両方サポート)
if (!process.env.ANTHROPIC_API_KEY && process.env.AI_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.AI_API_KEY;
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  // Secret 末尾改行/trailing slash 除去
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const ak = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!url || !srk) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  if (!ak) throw new Error("Missing ANTHROPIC_API_KEY");
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = srk;
  process.env.ANTHROPIC_API_KEY = ak;

  const sb = createClient(url, srk);

  // viewer 選定: 引数 > VIEWER_ID env > 最 active user
  let viewerId = process.argv[2] ?? process.env.VIEWER_ID;
  if (!viewerId) {
    const { data } = await sb
      .from("user_conversation_vectors")
      .select("user_id, analysis_count")
      .order("analysis_count", { ascending: false })
      .limit(1);
    viewerId = (data as { user_id: string }[] | null)?.[0]?.user_id;
    if (!viewerId) throw new Error("No user_conversation_vectors rows to judge");
    console.log(`[run-judge-local] auto-selected most active viewer=${viewerId}`);
  }

  // targets: viewer 以外の全 active profile (上位 50 まで)
  const { data: targets } = await sb
    .from("user_profiles")
    .select("id")
    .eq("is_active", true)
    .neq("id", viewerId)
    .limit(50);
  const targetIds = ((targets ?? []) as { id: string }[]).map((t) => t.id);

  if (targetIds.length === 0) {
    console.log("[run-judge-local] no targets; nothing to do");
    return;
  }

  const { handleJudgePairBatch } = await import("../worker/src/handlers/judge");

  console.log(`[run-judge-local] viewer=${viewerId} targets=${targetIds.length}`);
  await handleJudgePairBatch({
    viewer_id: viewerId,
    target_ids: targetIds,
    top_n: 50,
  });
  console.log("[run-judge-local] done");
}

main().catch((err) => {
  console.error("[run-judge-local] FAILED:", err);
  process.exit(1);
});
