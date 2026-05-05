/**
 * Backfill embeddings for ALL users with user_conversation_vectors.
 * Run once after applying migration 00021_pgvector.
 *
 * Usage:
 *   npx tsx worker/scripts/backfill-embeddings.ts
 *
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               OPENAI_API_KEY.
 *
 * Cost (text-embedding-3-small @ $0.02 / 1M tokens):
 *   61 needs × ~200 tok =  12,200
 *   67 offers × ~200 tok = 13,400
 *  112 topics × ~30 tok =   3,360
 *   ───────────────────────────────
 *   ~29k tokens ≈ $0.0006   (well under $0.01)
 *
 * Idempotent: text_hash check skips already-embedded items.
 */

import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { handleEmbed } from "../src/handlers/embed";

async function main(): Promise<void> {
  // Secret 値末尾改行/空白/trailing slash 除去 (PGRST125 防御)
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const openai = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!url || !key) throw new Error("Missing Supabase env");
  if (!openai) throw new Error("Missing OPENAI_API_KEY");
  // 後段 handleEmbed が queue.ts の supabase client を使うので env を上書きしておく
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  process.env.OPENAI_API_KEY = openai;

  const sb = createClient(url, key);

  const { data: rows, error } = await sb
    .from("user_conversation_vectors")
    .select("user_id");

  if (error) throw error;
  if (!rows?.length) {
    console.log("No user_conversation_vectors rows; nothing to backfill.");
    return;
  }

  console.log(`Backfilling embeddings for ${rows.length} users...`);

  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      await handleEmbed({ user_id: r.user_id });
      ok++;
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] user ${r.user_id} failed:`, msg);
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error("backfill fatal:", err);
  process.exit(1);
});
