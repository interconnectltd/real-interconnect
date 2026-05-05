"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api-client";
import type { Profile } from "@/types";

/**
 * 真のプロフィール完成度を測る詳細スコア。
 *
 * 旧実装の問題:
 *   7項目のうち「会社/役職/業種/名前」を埋めるだけで 60% 即達 →
 *   「90% で完成度満タンに見える」がマッチング精度には全く効かない。
 *
 * v2 配点 (2026-05-05 alpha 整合化 — Z1〜Z5):
 *   旧版は tl;dv 配分が 10点 と過小。マッチングの alpha 0→0.95 を駆動する
 *   analysisCount が core lever なのに完成度メーターでは bio 25 や基本 20 の
 *   半分以下しかなかった。SCORING_V2_ARCHITECTURE.md §4.4 の alpha 段階
 *   (0.50 / 0.75 / 0.88 / 0.95) と 1:1 で対応する 5 段階配点 (5+5+5+5+5 = 25)
 *   に再設計し、配分を analysis 重視へシフトする。
 *
 *   構造: 7 グループ / 計 19 項目 / 100 点 ── ARCHITECTURE_V4_UNIFIED.md #A16 と 1:1。
 *     A 基本(15) + B アイコン(2) + C 自己紹介(20) + D 目標/提供(30) +
 *     E 連絡先・同意(5) + F 会話分析(25=alpha lever) + G SNS/Web(3)
 *   旧 v1 の "7フィールド単純加算 100 点制" は破棄。ここで述べる "7" は
 *   フィールド数ではなく、グループ数 (= UI category bar の本数) を指す。
 *
 *   ─────────── A. 基本情報 (15点) ───────────
 *   [4] お名前 / [4] 会社名 / [4] 役職 / [3] 業種 (enum選択)
 *   旧 20 → 15。「氏名+所属」入力のみで頭打ちにならないよう -5。
 *
 *   ─────────── B. アイコン (2点) ───────────
 *   [2] avatar_url (preset / http / 設定済)
 *   旧 5 → 2。重要度低のため大幅圧縮。
 *
 *   ─────────── C. 自己紹介の質 (20点 / 5段階グラデーション) ───────────
 *   段階方式: 50/100/150/250/400字 × 4点 = 20点 (Z3)。
 *   "あと N字で +4%" の near-feedback で 80→81字の cliff jump を解消。
 *
 *   ─────────── D. ゴール/提供 (30点 / 3段階 + detail 重み) ───────────
 *   各 1件 / 3件 / 5件 の 3tier (実効件数で判定):
 *     goals_1 (10) / goals_3 (3) / goals_5 (2)
 *     offerings_1 (10) / offerings_3 (3) / offerings_5 (2)
 *   Z4 detail 重み: detail.length >= 30字 → 1.0、 0〜29字 → 0.5。
 *   短い detail は 2件で tier1 (>=1.0) に届き、長い detail なら 1件で届く。
 *   API (/profile/completeness-extras) が goals_metrics.effective を返す。
 *
 *   ─────────── E. 連絡先・同意 (5点) ───────────
 *   [3] contact_info が空でない
 *   [2] contact_sharing_consent_at が登録済 (onboarding 必須なので暗黙)
 *   旧 10 → 5。consent は onboarding 完了で自動取得される暗黙加点。
 *
 *   ─────────── F. 会話分析 (25点 — alpha 駆動の core lever) ───────────
 *   設計書 §4.4 の alpha 段階と 1:1 対応:
 *     [5] 1回分析   → alpha 0.50 (純粋属性 → 50% 反映)
 *     [5] 2回分析   → alpha 0.75
 *     [5] 3回分析   → alpha 0.88
 *     [5] 4回分析   → alpha 0.95 (上限到達)
 *     [5] 5回以上   → Lv3 推薦解禁
 *   旧 10 → 25。alpha lever を完成度に正しく反映する最大の修正。
 *
 *   ─────────── G. SNS / Web 公開 (3点) ───────────
 *   [3] contact_info に URL を含む (公開実体性の補強 / API 変更不要)
 *
 *   合計: 15 + 2 + 20 + 30 + 5 + 25 + 3 = 100点。
 *   bio 400字 + ゴール/提供 各5件 + tl;dv 5回分析 + SNS URL を全部達成して
 *   初めて 100% に到達する設計。
 *
 *   既存ユーザー影響 (break-change log / UX regression note):
 *     ・onboarding 直後 (bio/goals/offerings/tldv 未登録):
 *         旧: 基本 20 + アイコン 5 + 連絡先 10 = 35
 *         新: 基本 15 + アイコン 2 + 連絡先 5 = 22 → 約 -13。仕様。
 *     ・bio 充実 + goals/offerings 各 5 (tldv 0):
 *         旧: 20+5+20+30+10+0 = 85 / 新: 15+2+20+30+5+0+sns(0-3) = 72-75。
 *         tl;dv 接続誘導の余地として正しい挙動。
 *     ・tl;dv 5回以上分析済: +(15) 上振れ (10→25)。
 */

export interface CompletenessFieldCheck {
  key: string;
  label: string;
  hint: string;
  /** 何点配点 */
  points: number;
  /** Profile 編集ページの該当セクションへの aim (UI hint) */
  hash?: string;
  done: boolean;
}

export interface CompletenessGroup {
  id: string;
  label: string;
  total: number;
  earned: number;
  fields: CompletenessFieldCheck[];
}

export interface CompletenessResult {
  /** 0-100 */
  score: number;
  groups: CompletenessGroup[];
  missing: CompletenessFieldCheck[];
}

interface CompletenessExtras {
  goalsCount: number;
  offeringsCount: number;
  /**
   * Z4: detail 文字数評価込みの「実効件数」。
   *   detail.length >= 30字 → 1.0、 0〜29字 → 0.5。
   *   tier 判定はこの実効件数で行う:
   *     ・短い detail でも 2 件で tier1 (>=1.0) に届く  ← 「届きやすさ」
   *     ・長い detail なら 1 件で tier1                 ← 「精度寄与」
   *   両立が成立する。未提供 (旧 API レスポンス) なら count にフォールバック。
   */
  goalsEffective?: number;
  offeringsEffective?: number;
  /** Z4: detail の平均文字数 (tooltip 表示用、判定には未使用)。 */
  goalsAvgDetailLen?: number;
  offeringsAvgDetailLen?: number;
  consentAt: string | null;
  analyzedCount: number;
}

function nonEmpty(v: string | null | undefined): boolean {
  return Boolean(v && v.trim().length > 0);
}

/**
 * contact_info に URL or 主要 SNS ハンドルが含まれるかをラフ判定 (新規 SNS group 用)。
 * Profile スキーマに専用 sns カラムが無いため、contact_info を解析する形で
 * API 変更なし (=/profile/completeness-extras 互換) を実現する。
 */
function hasUrlLike(v: string | null | undefined): boolean {
  if (!v) return false;
  return /https?:\/\/|(^|\s)(@|x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|note\.com|github\.com|youtube\.com)/i.test(v);
}

/** bio セクションの 5段階 tier 定義 (上限/配点)。合計 20 点。 */
const BIO_TIERS: ReadonlyArray<{ threshold: number; points: number; label: string }> = [
  { threshold: 50, points: 4, label: "自己紹介 50文字以上" },
  { threshold: 100, points: 4, label: "自己紹介 100文字以上" },
  { threshold: 150, points: 4, label: "自己紹介 150文字以上" },
  { threshold: 250, points: 4, label: "自己紹介 250文字以上" },
  { threshold: 400, points: 4, label: "自己紹介 400文字以上" },
];

/**
 * bio 文字数 → "あと N字で +M%" 形式の近接フィードバック hint。
 * - 既達成 tier: 「達成済 (現在 N字)」
 * - 未達 tier: 「あと M 字で +P% (現在 N字 / 目標 T字)」
 * 80→81 で +10 という cliff jump を解消し、毎入力で進捗を体感できる。
 */
function bioHint(bioLen: number, tierIndex: number): string {
  const tier = BIO_TIERS[tierIndex];
  if (!tier) return "";
  if (bioLen >= tier.threshold) {
    return `達成済 (現在 ${bioLen}字)`;
  }
  const remain = tier.threshold - bioLen;
  return `あと ${remain} 字で +${tier.points}% (現在 ${bioLen}字 / 目標 ${tier.threshold}字)`;
}

function bioGroup(bioLen: number): CompletenessGroup {
  const total = BIO_TIERS.reduce((s, t) => s + t.points, 0);
  return {
    id: "bio",
    label: "自己紹介の充実度",
    total,
    earned: 0,
    fields: BIO_TIERS.map((tier, i) => ({
      key: `bio_${tier.threshold}`,
      label: tier.label,
      hint: bioHint(bioLen, i),
      points: tier.points,
      done: bioLen >= tier.threshold,
    })),
  };
}

/**
 * goals/offerings 用: 現在件数 → 次の tier までの差分 hint。
 * tiers と pointsByTier は同 index で対応。最終 tier 達成済なら最高ランク表示。
 *
 * Z4 拡張: count は「実効件数 (detail 文字数評価込み)」を許容するため小数 OK。
 * avgDetailLen が指定されたら hint 末尾に detail 平均文字数を併記し、
 * 「detail を 30字 以上書くと 1件 = 1.0、未満は 0.5」の因果を可視化する。
 */
function nextTierHint(
  count: number,
  tiers: ReadonlyArray<number>,
  kind: string,
  pointsByTier: ReadonlyArray<number>,
  avgDetailLen?: number,
): string {
  const fmt = (n: number): string => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  const avgSuffix =
    avgDetailLen !== undefined && avgDetailLen > 0
      ? ` ／ detail 平均 ${fmt(avgDetailLen)}字 (30字で 1件分加算)`
      : "";
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const p = pointsByTier[i];
    if (t === undefined || p === undefined) continue;
    if (count < t) {
      const diff = Math.max(0, t - count);
      return `あと ${fmt(diff)} 件で +${p}% (現在 ${fmt(count)} 件 / 次の節目 ${t} 件)${avgSuffix}`;
    }
  }
  return `最高ランク達成 (${kind} ${fmt(count)} 件)${avgSuffix}`;
}

export function calcDetailedCompleteness(
  profile: Profile & { contact_sharing_consent_at?: string | null },
  extras: CompletenessExtras,
): CompletenessResult {
  const bio = profile.bio ?? "";
  const bioLen = bio.trim().length;

  const groups: CompletenessGroup[] = [
    {
      id: "basic",
      label: "基本情報",
      total: 15,
      earned: 0,
      fields: [
        { key: "name", label: "お名前", hint: "本名を入力", points: 4, hash: "/profile#profile-name", done: nonEmpty(profile.name) },
        { key: "company", label: "会社名", hint: "所属企業を追加", points: 4, hash: "/profile#profile-company", done: nonEmpty(profile.company) },
        { key: "position", label: "役職", hint: "役職を追加", points: 4, hash: "/profile#profile-position", done: nonEmpty(profile.position) },
        { key: "industry", label: "業種", hint: "業種を選択", points: 3, hash: "/profile#profile-industry", done: nonEmpty(profile.industry) },
      ],
    },
    {
      id: "avatar",
      label: "アイコン",
      total: 2,
      earned: 0,
      fields: [
        { key: "avatar_url", label: "アイコン", hint: "プリセット/写真を選択", points: 2, hash: "/profile#profile-avatar", done: nonEmpty(profile.avatar_url) },
      ],
    },
    (() => {
      const g = bioGroup(bioLen);
      // 各 tier に /profile#profile-bio anchor を仕込み、完成度カードの
      // missing item クリック → /profile の textarea にスクロール+focus する。
      g.fields = g.fields.map((f) => ({ ...f, hash: "/profile#profile-bio" }));
      return g;
    })(),
    (() => {
      // Z4: tier 判定は「実効件数」(detail >= 30字 = 1.0、未満 = 0.5) で行う。
      // API が新フィールドを返さない過去レスポンスでも安全に降格できるよう、
      // goalsEffective/offeringsEffective が undefined ならば count にフォールバック。
      const goalsEff = extras.goalsEffective ?? extras.goalsCount;
      const offeringsEff = extras.offeringsEffective ?? extras.offeringsCount;
      const goalsAvg = extras.goalsAvgDetailLen;
      const offeringsAvg = extras.offeringsAvgDetailLen;
      const goalsTiers: ReadonlyArray<number> = [1, 3, 5];
      const goalsPts: ReadonlyArray<number> = [10, 3, 2];
      return {
        id: "goals",
        label: "目標・提供できること",
        total: 30,
        earned: 0,
        fields: [
          { key: "goals_1", label: "目標を1件以上登録", hint: nextTierHint(goalsEff, goalsTiers, "目標", goalsPts, goalsAvg), points: 10, hash: "/onboarding", done: goalsEff >= 1 },
          { key: "goals_3", label: "目標を3件以上登録", hint: nextTierHint(goalsEff, goalsTiers, "目標", goalsPts, goalsAvg), points: 3, hash: "/onboarding", done: goalsEff >= 3 },
          { key: "goals_5", label: "目標を5件以上登録", hint: nextTierHint(goalsEff, goalsTiers, "目標", goalsPts, goalsAvg), points: 2, hash: "/onboarding", done: goalsEff >= 5 },
          { key: "offerings_1", label: "提供を1件以上登録", hint: nextTierHint(offeringsEff, goalsTiers, "提供", goalsPts, offeringsAvg), points: 10, hash: "/onboarding", done: offeringsEff >= 1 },
          { key: "offerings_3", label: "提供を3件以上登録", hint: nextTierHint(offeringsEff, goalsTiers, "提供", goalsPts, offeringsAvg), points: 3, hash: "/onboarding", done: offeringsEff >= 3 },
          { key: "offerings_5", label: "提供を5件以上登録", hint: nextTierHint(offeringsEff, goalsTiers, "提供", goalsPts, offeringsAvg), points: 2, hash: "/onboarding", done: offeringsEff >= 5 },
        ],
      } satisfies CompletenessGroup;
    })(),
    {
      id: "contact",
      label: "連絡先・同意",
      total: 5,
      earned: 0,
      fields: [
        { key: "contact_info", label: "連絡先入力", hint: "コネクション成立後に共有", points: 3, hash: "/profile#profile-contact", done: nonEmpty(profile.contact_info) },
        { key: "consent", label: "第三者提供同意", hint: "オンボーディング完了で取得", points: 2, done: Boolean(extras.consentAt) },
      ],
    },
    {
      // SCORING_V2_ARCHITECTURE.md §4.4 alpha 段階 (0.50 / 0.75 / 0.88 / 0.95)
      // と 1:1 対応する 5 段階 × 5点 = 25点。tier i を達成 → alpha[i] が解放、
      // という整合関係を完成度メーターに直接反映する core lever。
      id: "tldv",
      label: "会話分析の蓄積",
      total: 25,
      earned: 0,
      fields: [
        { key: "tldv_1", label: "1回分析 (alpha 0.50)", hint: "AI 推薦に会話の文脈が 50% 反映", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 1 },
        { key: "tldv_2", label: "2回分析 (alpha 0.75)", hint: "縦断分析で趣向を学習中 (75%)", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 2 },
        { key: "tldv_3", label: "3回分析 (alpha 0.88)", hint: "推薦が会話駆動に近づく (88%)", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 3 },
        { key: "tldv_4", label: "4回分析 (alpha 0.95)", hint: "alpha 上限到達 — 推薦が最大精度", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 4 },
        { key: "tldv_5", label: "5回以上 (Lv3 解禁)", hint: "高精度推薦が解禁され通知 tier も拡張", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 5 },
      ],
    },
    {
      id: "sns",
      label: "SNS / Web 公開",
      total: 3,
      earned: 0,
      fields: [
        { key: "sns_url", label: "SNS / Web URL を連絡先に記載", hint: "URL や @handle を含めると公開実体性が上がります", points: 3, done: hasUrlLike(profile.contact_info) },
      ],
    },
  ];

  for (const g of groups) {
    g.earned = g.fields.reduce((sum, f) => sum + (f.done ? f.points : 0), 0);
  }

  const score = groups.reduce((sum, g) => sum + g.earned, 0);
  const missing = groups.flatMap((g) => g.fields.filter((f) => !f.done));

  return { score, groups, missing };
}

/** Z4: extras API が返す detail 評価込みメトリクス。新規フィールドは optional。 */
interface DetailMetricsResponse {
  count: number;
  effective: number;
  full_count: number;
  partial_count: number;
  avg_detail_length: number;
}

interface RawExtras {
  goals: number;
  offerings: number;
  /** Z4: 旧 API 互換のため optional。未指定なら count を実効件数にフォールバック。 */
  goals_metrics?: DetailMetricsResponse;
  offerings_metrics?: DetailMetricsResponse;
  consent_at: string | null;
  analyzed_count: number;
  /** Z4: linkedin_id (現在は未使用 / Z1 が contact_info ベースで判定中)。 */
  linkedin_id?: string | null;
}

/**
 * 詳細完成度の取得 hook。
 * goals/offerings/consent/analyzedCount は API 経由で取得 (60s 間キャッシュ)。
 */
export function useProfileCompleteness(
  profile: (Profile & { contact_sharing_consent_at?: string | null }) | null | undefined,
) {
  const { data: extras } = useQuery({
    queryKey: ["profile-completeness-extras"],
    queryFn: () => api.get<RawExtras>("/profile/completeness-extras"),
    // profile 更新で goals/offerings/consent が即変わるため stale 0 + 短 cache
    staleTime: 5_000,
    enabled: Boolean(profile?.id),
  });

  // extras object reference は queryClient で再生成される可能性があるため
  // 各 primitive 値を依存に分解 (useMemo 過剰再計算抑止)
  const goals = extras?.goals ?? 0;
  const offerings = extras?.offerings ?? 0;
  // Z4: detail 評価込みの実効件数 (旧 API では undefined → calc 側で count にフォールバック)
  const goalsEffective = extras?.goals_metrics?.effective;
  const offeringsEffective = extras?.offerings_metrics?.effective;
  const goalsAvgDetailLen = extras?.goals_metrics?.avg_detail_length;
  const offeringsAvgDetailLen = extras?.offerings_metrics?.avg_detail_length;
  const consentAt = extras?.consent_at ?? profile?.contact_sharing_consent_at ?? null;
  const analyzedCount = extras?.analyzed_count ?? 0;

  return useMemo(() => {
    if (!profile) return null;
    return calcDetailedCompleteness(profile, {
      goalsCount: goals,
      offeringsCount: offerings,
      goalsEffective,
      offeringsEffective,
      goalsAvgDetailLen,
      offeringsAvgDetailLen,
      consentAt,
      analyzedCount,
    });
  }, [
    profile,
    goals,
    offerings,
    goalsEffective,
    offeringsEffective,
    goalsAvgDetailLen,
    offeringsAvgDetailLen,
    consentAt,
    analyzedCount,
  ]);
}
