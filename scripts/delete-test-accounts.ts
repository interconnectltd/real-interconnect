// 開発中に作ったテスト/ダミーアカウントを service role で一括削除する。
//
// 抽出条件 (AND):
//   - user_profiles.email が DELETE_EMAILS に完全一致 (大文字小文字無視)
//   - prospect_invite_at IS NULL          … 招待済みの実在見込み客は保護 (belt-and-suspenders)
//   - is_admin = false                    … 運営アカウントは保護 (belt-and-suspenders)
//   (削除対象はユーザーが目視確定した明示リスト。パターンの取りこぼし/誤爆を避けるため完全一致)
//
// 安全設計:
//   - デフォルトは dry-run。対象一覧を表示するだけで何も消さない。
//   - 実削除には --apply フラグ かつ 環境変数 CONFIRM=DELETE の両方が必須 (二重ガード)。
//
// 削除の仕組み:
//   1. 当該ユーザーの user_terms_acceptances 行を先に物理削除する。
//      (本番スキーマには user_id が NOT NULL かつ FK が ON DELETE SET NULL という
//       矛盾があり、これが残っていると auth.users 削除が NOT NULL 違反で失敗する。
//       ダミーは退会後保持の対象外なので行ごと消して問題ない。
//       恒久対処は migration 00070 で user_id を NULLABLE 化すること。)
//   2. auth.admin.deleteUser(id) で削除 → ON DELETE CASCADE で user_profiles /
//      settings / user_goals / user_offerings / meeting_participants 等が連鎖削除。
//
// Usage:
//   npx tsx scripts/delete-test-accounts.ts                         # dry-run (一覧のみ)
//   CONFIRM=DELETE npx tsx scripts/delete-test-accounts.ts --apply  # 実削除

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 削除対象の email 完全一致リスト (ユーザーが目視確定した明示リスト)。
const DELETE_EMAILS = [
  "dummy01@gmail.com",
  "agency-test-001@example.com",
  "agency-test-002@example.com",
  "workspace.challenge258+agent-test@gmail.com",
  "suzuki.akari.test@gmail.com",
  "tanaka.kenta.test@gmail.com",
  "workspace.challenge258@gmail.com", // ユーザー確認済: 本人が作成したダミー
];

interface TargetRow {
  id: string;
  email: string | null;
  name: string | null;
  prospect_invite_at: string | null;
  is_admin: boolean | null;
  is_agency: boolean | null;
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");

  const url = envOrThrow("NEXT_PUBLIC_SUPABASE_URL");
  const key = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  const supabase: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) 対象抽出: email 完全一致 (in) かつ prospect_invite_at IS NULL
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, email, name, prospect_invite_at, is_admin, is_agency")
    .in("email", DELETE_EMAILS)
    .is("prospect_invite_at", null);
  if (error) {
    console.error("[fatal] failed to query targets:", error.message);
    process.exit(1);
  }

  // 運営アカウント (is_admin) は念のためコード側でも除外
  const targets = ((data ?? []) as TargetRow[]).filter(
    (t) => t.is_admin !== true,
  );

  console.log("========================================");
  console.log(" delete-test-accounts");
  console.log("  requested:", DELETE_EMAILS.length, "emails");
  console.log("  matched (prospect_invite_at IS NULL, is_admin=false):", targets.length);
  console.log("========================================");
  for (const t of targets) {
    const flags = [
      t.is_agency ? "is_agency" : null,
    ]
      .filter(Boolean)
      .join(",");
    console.log(
      `  - ${t.id}  ${t.email ?? "(no email)"}  ${t.name ?? ""}${flags ? `  [${flags}]` : ""}`,
    );
  }

  if (targets.length === 0) {
    console.log("[done] no targets. exit.");
    return;
  }

  // 2) 安全ガード: --apply かつ CONFIRM=DELETE の両方が無ければ dry-run で終了
  const confirmed = apply && process.env.CONFIRM === "DELETE";
  if (!confirmed) {
    console.log("");
    console.log("[dry-run] 何も削除していません。");
    console.log(
      "[dry-run] 実削除するには: CONFIRM=DELETE npx tsx scripts/delete-test-accounts.ts --apply",
    );
    return;
  }

  // 3) 1件ずつ削除 (同意記録の事前削除 → deleteUser)
  console.log("");
  console.log(`[apply] deleting ${targets.length} users...`);
  let ok = 0;
  let failed = 0;
  for (const t of targets) {
    // 3-1) NOT NULL / SET NULL 矛盾を回避するため同意記録を先に物理削除
    const { error: utaErr } = await supabase
      .from("user_terms_acceptances")
      .delete()
      .eq("user_id", t.id);
    if (utaErr) {
      console.warn(
        `[warn] delete user_terms_acceptances ${t.id} (${t.email}):`,
        utaErr.message,
      );
    }

    // 3-2) auth.users 削除 (CASCADE で関連テーブルが連鎖削除)
    const { error: delErr } = await supabase.auth.admin.deleteUser(t.id);
    if (delErr) {
      failed++;
      console.warn(`[warn] deleteUser ${t.id} (${t.email}):`, delErr.message);
    } else {
      ok++;
      console.log(`[ok] deleted ${t.id} (${t.email})`);
    }
  }

  // 4) 集計
  console.log("");
  console.log("========================================");
  console.log(`  deleted: ${ok}`);
  console.log(`  failed:  ${failed}`);
  console.log("========================================");
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
