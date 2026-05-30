/**
 * scripts/create-member-account.ts
 *
 * 運営側で会員アカウントを **下準備済み** の状態で作成する CLI。
 *
 * できること:
 *   - 指定した名前で Supabase アカウントを作成 (招待メールは送らない)
 *   - 過去 tl;dv 会議の meeting_participants を user_id に backfill
 *   - 同意ゲート (prospect_invite_at) を発動状態にする
 *   - モニター/無料 プランを付与可能 (--plan)
 *   - クレデンシャルを CLI 出力 → 運営が本人に手渡し
 *
 * 使い方:
 *   npx tsx scripts/create-member-account.ts --name "田中健太"
 *   npx tsx scripts/create-member-account.ts --name "田中健太" --plan=monitor
 *   npx tsx scripts/create-member-account.ts --name "田中健太" --email=tanaka@example.com
 *   npx tsx scripts/create-member-account.ts --name "田中健太" --dry-run
 *
 * 既存の bulk-invite-prospects との違い:
 *   - 招待メールを送らず、運営がクレデンシャルを直接受け取る
 *   - 名前指定で1人ずつ作成 (バッチではない)
 *   - --plan でモニター/無料 プランを付与可能
 *
 * 既存仕組みの再利用:
 *   - prospect_invite_at をセットすることで、ログイン時に既存の同意ゲートが動く
 *   - 同意後に promote_pending_consent_for_user RPC が自動で transcript ready 化
 *   - 14日 expiry の cleanup_expired_prospects が自動で放置アカウントを掃除
 *   - 拒否時の REDACT 処理も既存と同じく動作
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

loadEnv({ path: ".env.local", quiet: true });

interface CliArgs {
  name: string | null;
  email: string | null;
  transcripts: string[] | null; // tldv_meeting_id の配列
  plan: "monitor" | "free" | null;
  dryRun: boolean;
  allowEmpty: boolean;
  force: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (key: string): string | null => {
    // --key=value 形式
    const eq = args.find((a) => a.startsWith(`--${key}=`));
    if (eq) return eq.slice(key.length + 3);
    // --key value 形式
    const idx = args.findIndex((a) => a === `--${key}`);
    if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
      return args[idx + 1];
    }
    return null;
  };
  const planRaw = get("plan");
  let plan: "monitor" | "free" | null = null;
  if (planRaw === "monitor" || planRaw === "free") {
    plan = planRaw;
  } else if (planRaw && planRaw !== "") {
    throw new Error(
      `--plan は monitor / free のいずれかを指定してください (与えられた値: ${planRaw})`,
    );
  }
  return {
    name: get("name"),
    email: get("email"),
    transcripts: get("transcripts")
      ? get("transcripts")!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    plan,
    dryRun: args.includes("--dry-run"),
    allowEmpty: args.includes("--allow-empty"),
    force: args.includes("--force"),
  };
}

function generateSecurePassword(length = 16): string {
  // Base64-url から記号を含めた 16 文字を作る
  const chars =
    "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  if (!args.name) {
    console.error("[error] --name を指定してください");
    console.error("使い方: npx tsx scripts/create-member-account.ts --name \"田中健太\" [--plan=monitor]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  const supabase = createClient(url, key);

  console.log(`\n========================================`);
  console.log(` create-member-account`);
  console.log(`========================================`);
  console.log(` 名前    : ${args.name}`);
  console.log(` プラン  : ${args.plan ?? "未指定 (Stripe基準)"}`);
  console.log(` メール  : ${args.email ?? "(placeholder を自動生成)"}`);
  console.log(` 会議指定: ${args.transcripts?.length ? args.transcripts.join(", ") : "全体検索 (名前一致)"}`);
  console.log(` モード  : ${args.dryRun ? "DRY-RUN" : "実行"}`);
  console.log(`========================================\n`);

  // ────────────────────────────────────────
  // STEP 1: 重複ガード
  // ────────────────────────────────────────
  console.log("[1/8] 重複ガード...");
  const { data: dupes, error: dupErr } = await supabase
    .from("user_profiles")
    .select("id, email, prospect_invite_at, manual_plan")
    .eq("name", args.name);
  if (dupErr) throw dupErr;
  const activeDupes = (dupes ?? []).filter((d) => d.prospect_invite_at != null);
  if (activeDupes.length > 0 && !args.force) {
    console.error(
      `[abort] 同名で運営作成済みのアカウントが既に存在します: ${activeDupes
        .map((d) => `${d.email} (manual_plan=${d.manual_plan ?? "null"})`)
        .join(", ")}`,
    );
    console.error("       上書きするには --force を付けて再実行してください");
    process.exit(1);
  }
  console.log(`      → ${dupes?.length ?? 0} 件マッチ (うち operator-created: ${activeDupes.length})`);

  // ────────────────────────────────────────
  // STEP 2: 紐付け対象 participants の抽出
  // ────────────────────────────────────────
  console.log("[2/8] 紐付け対象 participants を抽出...");
  let participantQuery = supabase
    .from("meeting_participants")
    .select("id, transcript_id, speaker_name, email, user_id")
    .ilike("speaker_name", `%${args.name}%`)
    .is("user_id", null);
  if (args.transcripts && args.transcripts.length > 0) {
    // tldv_meeting_id から transcript_id に変換
    const { data: transcripts } = await supabase
      .from("meeting_transcripts")
      .select("id")
      .in("tldv_meeting_id", args.transcripts);
    const ids = (transcripts ?? []).map((t) => t.id);
    participantQuery = participantQuery.in("transcript_id", ids);
  }
  const { data: candidates, error: candErr } = await participantQuery;
  if (candErr) throw candErr;
  const targetIds = (candidates ?? []).map((c) => c.id);
  const targetTranscriptIds = Array.from(
    new Set((candidates ?? []).map((c) => c.transcript_id)),
  );
  console.log(
    `      → ${targetIds.length} 件の participant / ${targetTranscriptIds.length} 件の transcript`,
  );
  if (targetIds.length === 0 && !args.allowEmpty) {
    console.error(
      `[abort] 名前 "${args.name}" にマッチする未紐付け participant が見つかりません`,
    );
    console.error("       空でも作成するには --allow-empty を付けてください");
    process.exit(1);
  }

  if (args.dryRun) {
    console.log("\n========================================");
    console.log(" [DRY-RUN] 実際の作成は行いません");
    console.log("========================================");
    console.log(` 作成予定: 名前=${args.name}, plan=${args.plan ?? "null"}`);
    console.log(` 紐付け予定: ${targetIds.length} participants in ${targetTranscriptIds.length} transcripts`);
    if (candidates && candidates.length > 0) {
      console.log(`\n 対象 participant の最初の 5 件:`);
      for (const c of candidates.slice(0, 5)) {
        console.log(`   - ${c.speaker_name} (transcript_id=${c.transcript_id.slice(0, 8)}..., email=${c.email ?? "null"})`);
      }
    }
    console.log("========================================\n");
    return;
  }

  // ────────────────────────────────────────
  // STEP 3: Supabase Auth ユーザー作成 (招待メール送信なし)
  // ────────────────────────────────────────
  console.log("[3/8] Supabase Auth ユーザー作成...");
  const tempPassword = generateSecurePassword(16);
  const placeholderEmail =
    args.email ?? `temp-${randomUUID().slice(0, 8)}@inter-connect.app`;
  const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
    email: placeholderEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      name: args.name,
      operator_created: true,
      source: "create-member-account-cli",
    },
  });
  if (authErr) {
    console.error("[abort] auth user creation failed:", authErr.message);
    process.exit(1);
  }
  const userId = auth.user!.id;
  console.log(`      → user_id=${userId}`);

  // ────────────────────────────────────────
  // STEP 4: user_profiles を update (prospect_invite_at + manual_plan)
  // ────────────────────────────────────────
  console.log("[4/8] prospect_invite_at + manual_plan セット...");
  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const profileUpdate: Record<string, unknown> = {
    prospect_invite_at: new Date().toISOString(),
    prospect_invite_expires_at: expiresAt.toISOString(),
  };
  if (args.plan) {
    profileUpdate.manual_plan = args.plan;
  }
  const { error: profileErr } = await supabase
    .from("user_profiles")
    .update(profileUpdate)
    .eq("id", userId);
  if (profileErr) {
    console.error("[warn] user_profiles update failed:", profileErr.message);
  } else {
    console.log(`      → expires_at=${expiresAt.toISOString().slice(0, 10)}, manual_plan=${args.plan ?? "null"}`);
  }

  // ────────────────────────────────────────
  // STEP 5: meeting_participants backfill
  // ────────────────────────────────────────
  console.log("[5/8] meeting_participants.user_id backfill...");
  if (targetIds.length > 0) {
    const { error: bfErr } = await supabase
      .from("meeting_participants")
      .update({
        user_id: userId,
        is_linked: true,
        linked_method: "manual",
      })
      .in("id", targetIds);
    if (bfErr) {
      console.error("[warn] participants backfill failed:", bfErr.message);
    } else {
      console.log(`      → ${targetIds.length} 件 backfill 完了`);
    }
  } else {
    console.log("      → 対象 0 件 (--allow-empty 指定)");
  }

  // ────────────────────────────────────────
  // STEP 6: meeting_transcripts を pending_consent に揃える
  // ────────────────────────────────────────
  console.log("[6/8] transcript を pending_consent に...");
  if (targetTranscriptIds.length > 0) {
    const { error: txErr } = await supabase
      .from("meeting_transcripts")
      .update({ status: "pending_consent" })
      .in("id", targetTranscriptIds)
      .in("status", ["pending", "fetching", "ready"]);
    if (txErr) {
      console.error("[warn] transcripts status update failed:", txErr.message);
    } else {
      console.log(`      → ${targetTranscriptIds.length} 件処理`);
    }
  } else {
    console.log("      → 対象 0 件");
  }

  // ────────────────────────────────────────
  // STEP 7: bulk_invite_log 監査記録
  // ────────────────────────────────────────
  console.log("[7/8] bulk_invite_log 記録...");
  const { error: logErr } = await supabase.from("bulk_invite_log").insert({
    invited_by: null, // CLI 経由 (system user)
    email: placeholderEmail,
    user_id: userId,
    source_meeting_ids: targetTranscriptIds,
    status: "invited",
    metadata: {
      source: "create-member-account-cli",
      operator_created: true,
      name: args.name,
      plan: args.plan ?? null,
      placeholder_email: args.email == null,
      participant_count: targetIds.length,
      meeting_count: targetTranscriptIds.length,
      invite_sent_at: new Date().toISOString(),
      invite_expires_at: expiresAt.toISOString(),
    },
  });
  if (logErr) {
    console.error("[warn] bulk_invite_log insert failed:", logErr.message);
  } else {
    console.log("      → 記録完了");
  }

  // ────────────────────────────────────────
  // STEP 8: クレデンシャル出力
  // ────────────────────────────────────────
  console.log("[8/8] 完了\n");
  console.log("========================================");
  console.log(" ✅ アカウント作成完了");
  console.log("========================================");
  console.log(` 名前       : ${args.name}`);
  console.log(` ID         : ${userId}`);
  console.log(` プラン     : ${args.plan ?? "未指定"}`);
  console.log(` ログインURL: https://inter-connect.app/login`);
  console.log(` メール     : ${placeholderEmail}`);
  console.log(` パスワード : ${tempPassword}`);
  console.log(` 紐付け済み : ${targetIds.length}件 (${targetTranscriptIds.length}件の会議)`);
  console.log(` 有効期限   : ${expiresAt.toISOString().slice(0, 10)} (14日後)`);
  console.log("");
  console.log(" ⚠️ この情報を本人に安全な経路で渡してください");
  console.log(" ⚠️ 運営側では保管しないでください");
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
