// 孤児 auth user (前回失敗した seed の残骸) をクリーンアップ
//
// Usage: npx tsx scripts/cleanup-orphan-user.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";

const ORPHAN_USER_ID = "ab2cb284-dc7b-4f9f-9d41-cb1223d0f404";
const ORPHAN_EMAIL = "test+001@interconnect.test";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) auth.users から削除 (CASCADE で user_profiles, settings 等も消える)
  const { error } = await supabase.auth.admin.deleteUser(ORPHAN_USER_ID);
  if (error) {
    console.warn("[warn] deleteUser:", error.message);
  } else {
    console.log("[ok] deleted auth user", ORPHAN_USER_ID);
  }

  // 2) email 残存していないか確認
  const { data: rest } = await supabase
    .from("user_profiles")
    .select("id, email")
    .eq("email", ORPHAN_EMAIL);
  console.log("[check] remaining user_profiles with email:", rest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
