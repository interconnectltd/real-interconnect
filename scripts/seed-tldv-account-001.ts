// 仮アカウント生成 + tl;dv 会議データ紐付け seed (one-off)
//
//   email:        test+001@interconnect.test
//   tldv meeting: 699411f6931c400013eff67b
//   counterpart:  田口 恭平 (ラフメーカー株式会社)
//
// Usage:   npx tsx scripts/seed-tldv-account-001.ts
//
// 削除手順 (再実行する場合):
//   1) Supabase Dashboard > Authentication > Users で test+001@interconnect.test を delete
//      (CASCADE で user_profiles / settings / user_terms_acceptances /
//       user_goals / user_offerings / meeting_participants まで消える)
//   2) DELETE FROM public.meeting_transcripts WHERE tldv_meeting_id='699411f6931c400013eff67b';
//
// 設計メモ:
//   - 00050 handle_new_user trigger が auth.users INSERT 時に
//     a) raw_user_meta_data.consent を即 DELETE (legal evidence は user_terms_acceptances に一本化)
//     b) user_profiles を name/company/position/industry/bio 込みで自動生成
//     c) settings 行を自動生成
//     → consent は user_metadata 経由ではなく直接 user_terms_acceptances に INSERT する。
//   - meeting v1 (meeting_transcripts + meeting_participants) を採用。
//     v2 (meetings + meeting_participants_v2) は文字起こし保持カラムを持たないため不適合。
//   - full_text は tl;dv 生 transcript ではなく AI 要約版を採用 (生はラベル swap 多発のため)。

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const TLDV_MEETING_ID = "699411f6931c400013eff67b";
const COUNTERPART_EMAIL = "test+001@interconnect.test";
const COUNTERPART_NAME = "田口 恭平";
const COUNTERPART_COMPANY = "ラフメーカー株式会社";
const COUNTERPART_POSITION = "代表";
const COUNTERPART_INDUSTRY = "営業代行 / セールスコンサル";
const COUNTERPART_BIO =
  "経営者層向けトップダウン型営業代行 (年契約300万・粗利600万保証モデル)。年商約3億、従業員20名弱(正社員9名+業務委託/アルバイト7-8名)、14期目、41歳、28歳起業。前職は広告代理店マーケティング。";
const MEETING_TITLE = "meeting zoom たぐちきょうへい";
const MEETING_DATE = "2026-05-10T00:00:00+09:00";

const FULL_TEXT = `# 会議概要 (tl;dv AI 要約)

本会議は、sara が経営者マッチングコミュニティの構築プロジェクトについて、
ラフメーカー株式会社の田口京平氏にヒアリングを実施したもの。
sara は AI を活用して経営者同士の相性の良いマッチングを実現するシステムを開発中で、
2026年4月のサービス開始を目指して 200社程度の無料モニターを募集中。
本会議は 2 人目のインタビュー対象者となる田口氏から、事業内容、年収規模、従業員数、
ビジネスモデル、実績、経営スタンス、課題についての詳細な情報を収集した。

## ラフメーカー株式会社 / 田口京平氏

- 事業内容: 経営者層向けのトップダウン型営業代行サービス
- 年商: 約 3 億円
- 従業員数: 役員除き 正社員 9 名 + 業務委託・アルバイト 7-8 名 (計 20 名弱)
- ビジネスモデル: B2B、経営者とのビジネスマッチングを行いながら営業代行
- 収益モデル: 顧客企業から年間 300 万円の固定費、粗利ベースで 600 万円以上の売上保証
  - 月換算 25 万円程度
  - 成果報酬型ではなく固定費 + 保証売上モデル
  - 100 万円程度以上の高単価案件中心 (低単価多数案件は対応せず)
  - 平均月額 100 万円程度。サブスク型 (月 10 万円・年 100 万円) の顧客もある
- 14 期目、現在 41 歳、27-28 歳で起業 (それ以前はサラリーマン)

## 実績カテゴリー / 取扱商材

売上成長、資金調達、ウェブサイト制作、LP 制作、映像制作、クリエイティブ会社、
営業コンサル会社、保険・FP 関連企業、補助金・助成金申請会社、経営者団体、
節税商品、経費削減 (電気代等)、SNS 運用代行など多岐にわたる。

田口氏自身は広告代理店でマーケティングを担当していた経歴を持ち、
売り方の相談やアドバイスを通じて顧客から感謝されるケースがある。
特に自信がある領域はマーケティングスキル。

## 経営課題と求める相手

- 自社の売上は安定しており、顧客企業の中で上手くいっている / いっていない企業の差を
  改善したい (上手くいっていない顧客の売上を上げたい)。
- 求めるマッチング相手:
  1) 営業を手伝ってほしいと直接発注してくれる企業
  2) 同社の顧客企業に発注してくれる企業
- 課題が多くある社長との出会いを求める (人手不足、AI 化推進、システム導入など)。
  課題は外部に表出しないため見つけにくい。ある程度規模の大きい企業の社長との接点を増やす動きを日々取っている。

## 経営スタイル / 対話スタイル

- バランス型に近い。急成長を目指すというよりも、慎重に領域を絞った上で
  その領域内ではチャレンジングに取り組むアプローチ。
- 仕事上の対話: コンサルタント的立場もあるため話す側 6 割。プライベートでは聞く側 8 割。

## 個人的背景・副業

- 副業: シャンパンタワー用シャンパンコールの作成・納入 (ホスト業界向け)。
- プライベートでは食事・飲みに行くことが多い。喫煙はしない。

## システム設計上のフィードバック (sara への助言)

- 現在のヒアリング質問が一般的すぎるため、回答が似たり寄ったりになり
  AI のマッチング精度が低下する可能性がある。
- マッチング精度を高めるには、ヒアリング質問の深さ・ジャンルを売上向上など
  具体的な経営課題に寄せていく必要がある。
- 営業代行業界の常識・知識を AI に事前学習させ、業界固有の情報を
  多めに生成させてマッチングを行うことで精度を高められる。
`;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 0. 冪等性チェック
  const { data: existing } = await supabase
    .from("user_profiles")
    .select("id, email")
    .eq("email", COUNTERPART_EMAIL)
    .maybeSingle();
  if (existing) {
    console.error(
      `[abort] user already exists: ${(existing as { id: string }).id} (${COUNTERPART_EMAIL})`,
    );
    console.error("       delete first via Auth Dashboard if you want to re-seed");
    process.exit(1);
  }

  // 1. terms_versions 最新を取得
  const { data: tvRows, error: tvErr } = await supabase
    .from("terms_versions")
    .select("kind, version, effective_from")
    .order("effective_from", { ascending: false });
  if (tvErr) throw tvErr;
  const latestVersion: Record<string, string> = {};
  for (const r of (tvRows ?? []) as Array<{ kind: string; version: string }>) {
    if (!latestVersion[r.kind]) latestVersion[r.kind] = r.version;
  }
  for (const required of ["terms", "privacy", "tokushoho"] as const) {
    if (!latestVersion[required]) {
      throw new Error(
        `terms_versions missing kind=${required}; run migration 00006 first`,
      );
    }
  }
  console.log("[ok] terms versions:", latestVersion);

  // 2. パスワード生成 (16 chars 以上、英大小+記号+数字 を含む)
  const password = `Tt!${randomBytes(12).toString("base64url")}`;

  // 3. auth.users 作成 → handle_new_user trigger が user_profiles + settings 自動生成
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email: COUNTERPART_EMAIL,
    password,
    email_confirm: true,
    user_metadata: {
      name: COUNTERPART_NAME,
      company: COUNTERPART_COMPANY,
      position: COUNTERPART_POSITION,
      industry: COUNTERPART_INDUSTRY,
      bio: COUNTERPART_BIO,
    },
  });
  if (authErr) throw authErr;
  const userId = created.user!.id;
  console.log("[ok] auth user created:", userId);

  // 4. onboarding_step を 3 へ昇格 (consent_gate と onboarding_gate を抜ける)
  const { error: stepErr } = await supabase
    .from("user_profiles")
    .update({ onboarding_step: 3 })
    .eq("id", userId);
  if (stepErr) throw stepErr;
  console.log("[ok] onboarding_step = 3");

  // 5. user_terms_acceptances に直接 INSERT
  const acceptances = (["terms", "privacy", "tokushoho"] as const).map((kind) => ({
    user_id: userId,
    kind,
    version: latestVersion[kind]!,
    accepted_at: new Date().toISOString(),
    user_agent: "seed:tldv-001",
  }));
  const { error: termsErr } = await supabase
    .from("user_terms_acceptances")
    .insert(acceptances);
  if (termsErr) throw termsErr;
  console.log("[ok] user_terms_acceptances × 3 inserted");

  // 6. user_offerings (taxonomy_v2)
  const offeringsRows = [
    {
      user_id: userId,
      type: "sales_support",
      context:
        "経営者層向けトップダウン型営業代行。年契約300万・粗利600万保証モデル。100万円以上の高単価案件中心。",
      source: "manual",
      confidence: 1.0,
    },
    {
      user_id: userId,
      type: "marketing_pr",
      context: "広告代理店出身でマーケティング・売り方アドバイス。",
      source: "manual",
      confidence: 1.0,
    },
    {
      user_id: userId,
      type: "client_intro",
      context:
        "幅広い顧客ネットワーク (WEB/LP/映像制作、コンサル、保険・FP、補助金・助成金、節税、経費削減、SNS運用代行など)",
      source: "manual",
      confidence: 1.0,
    },
  ];
  const { error: offErr } = await supabase
    .from("user_offerings")
    .insert(offeringsRows);
  if (offErr) throw offErr;
  console.log("[ok] user_offerings × 3 inserted");

  // 7. user_goals (taxonomy_v2)
  const goalsRows = [
    {
      user_id: userId,
      type: "client_intro",
      context:
        "課題の多い社長との出会いを求める。人手不足/AI化推進/システム導入など多領域の経営課題を持つ規模ある会社の社長を希望。",
      source: "manual",
      confidence: 1.0,
    },
    {
      user_id: userId,
      type: "sales_support",
      context: "自社顧客 (幅広い商材) の発注先となる相手も探している。",
      source: "manual",
      confidence: 1.0,
    },
  ];
  const { error: goalsErr } = await supabase.from("user_goals").insert(goalsRows);
  if (goalsErr) throw goalsErr;
  console.log("[ok] user_goals × 2 inserted");

  // 8. meeting_transcripts UPSERT (real tldv_meeting_id を使用)
  const { data: tx, error: txErr } = await supabase
    .from("meeting_transcripts")
    .upsert(
      {
        tldv_meeting_id: TLDV_MEETING_ID,
        title: MEETING_TITLE,
        meeting_date: MEETING_DATE,
        full_text: FULL_TEXT,
        status: "ready",
        meeting_kind: "sales",
        classification_reason: "Manual seed via scripts/seed-tldv-account-001.ts",
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "tldv_meeting_id" },
    )
    .select("id")
    .single();
  if (txErr) throw txErr;
  const transcriptId = (tx as { id: string }).id;
  console.log("[ok] meeting_transcripts:", transcriptId);

  // 9. meeting_participants — 田口さんのみ (sara 側は要望により省略)
  const { data: participant, error: pErr } = await supabase
    .from("meeting_participants")
    .insert({
      transcript_id: transcriptId,
      user_id: userId,
      speaker_name: COUNTERPART_NAME,
      email: COUNTERPART_EMAIL,
      speaking_ratio: 0.55,
      is_linked: true,
      linked_method: "email",
    })
    .select("id")
    .single();
  if (pErr) throw pErr;
  const participantId = (participant as { id: string }).id;
  console.log("[ok] meeting_participants:", participantId);

  // 10. job_queue (analyze enqueue) → worker が AI プロフィール抽出を実行
  const { error: jobErr } = await supabase.from("job_queue").insert({
    type: "analyze",
    payload: { transcript_id: transcriptId, participant_id: participantId },
    status: "pending",
    priority: 10,
    attempts: 0,
    max_attempts: 3,
  });
  if (jobErr) throw jobErr;
  console.log("[ok] analyze job enqueued");

  // 結果出力
  console.log("");
  console.log("========================================");
  console.log(" Seed complete");
  console.log("  email:          ", COUNTERPART_EMAIL);
  console.log("  password:       ", password);
  console.log("  user_id:        ", userId);
  console.log("  transcript_id:  ", transcriptId);
  console.log("  participant_id: ", participantId);
  console.log("========================================");
  console.log("");
  console.log("次に: pnpm worker:dev で worker を立ち上げると analyze ジョブが処理されます。");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
