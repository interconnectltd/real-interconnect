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
 * 新実装方針 (合計100点、真の充実度を測る):
 *   ─────────── A. 基本情報 (20点) ───────────
 *   [5] お名前 (空でない)
 *   [5] 会社名 (空でない)
 *   [5] 役職 (空でない)
 *   [5] 業種 (enum選択)
 *
 *   ─────────── B. アイコン (5点) ───────────
 *   [5] avatar_url (preset / http / 設定済)
 *
 *   ─────────── C. 自己紹介の質 (25点 — 最重要) ───────────
 *   [10] bio が 80文字以上 (= 短すぎる挨拶を弾く)
 *   [10] bio が 200文字以上 (= 専門性が伝わる長さ)
 *   [5]  bio が 400文字以上 (= 経歴・実績まで含む)
 *
 *   ─────────── D. ゴール/提供 (30点 — マッチング精度の核) ───────────
 *   [10] user_goals に 1件以上 (= 求めているもの登録)
 *   [5]  user_goals に 2件以上 (複数の求め)
 *   [10] user_offerings に 1件以上 (= 提供できるもの登録)
 *   [5]  user_offerings に 2件以上 (複数の提供)
 *
 *   ─────────── E. 連絡先・同意 (10点) ───────────
 *   [5] contact_info が空でない
 *   [5] contact_sharing_consent_at が登録済 (onboarding 済)
 *
 *   ─────────── F. 会話分析 (10点 — Lv昇格と連動) ───────────
 *   [5] tl;dv 接続済 (= analyzed transcripts 1件以上)
 *   [5] 5件以上分析済 (Lv3 相当)
 *
 *   合計: 100点。実態として「90% 即達」は不可能、bio 400字 + ゴール/提供
 *   各2件 + tldv 5回分析 を全部達成して初めて 100% に到達する設計。
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
  consentAt: string | null;
  analyzedCount: number;
}

function nonEmpty(v: string | null | undefined): boolean {
  return Boolean(v && v.trim().length > 0);
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
      total: 20,
      earned: 0,
      fields: [
        { key: "name", label: "お名前", hint: "本名を入力", points: 5, done: nonEmpty(profile.name) },
        { key: "company", label: "会社名", hint: "所属企業を追加", points: 5, done: nonEmpty(profile.company) },
        { key: "position", label: "役職", hint: "役職を追加", points: 5, done: nonEmpty(profile.position) },
        { key: "industry", label: "業種", hint: "業種を選択", points: 5, done: nonEmpty(profile.industry) },
      ],
    },
    {
      id: "avatar",
      label: "アイコン",
      total: 5,
      earned: 0,
      fields: [
        { key: "avatar_url", label: "アイコン", hint: "プリセット/写真を選択", points: 5, done: nonEmpty(profile.avatar_url) },
      ],
    },
    {
      id: "bio",
      label: "自己紹介の充実度",
      total: 25,
      earned: 0,
      fields: [
        { key: "bio_80", label: "自己紹介 80文字以上", hint: "挨拶+専門領域 (現在 " + bioLen + "字)", points: 10, done: bioLen >= 80 },
        { key: "bio_200", label: "自己紹介 200文字以上", hint: "経験・関心まで具体化", points: 10, done: bioLen >= 200 },
        { key: "bio_400", label: "自己紹介 400文字以上", hint: "実績・成果も記載", points: 5, done: bioLen >= 400 },
      ],
    },
    {
      id: "goals",
      label: "目標・提供できること",
      total: 30,
      earned: 0,
      fields: [
        { key: "goals_1", label: "目標を1つ以上登録", hint: "求めるつながりを選択", points: 10, hash: "/onboarding", done: extras.goalsCount >= 1 },
        { key: "goals_2", label: "目標を2つ以上登録", hint: "複数のニーズを明示", points: 5, hash: "/onboarding", done: extras.goalsCount >= 2 },
        { key: "offerings_1", label: "提供できることを1つ以上登録", hint: "あなたが価値を出せる領域", points: 10, hash: "/onboarding", done: extras.offeringsCount >= 1 },
        { key: "offerings_2", label: "提供できることを2つ以上登録", hint: "複数の専門性を明示", points: 5, hash: "/onboarding", done: extras.offeringsCount >= 2 },
      ],
    },
    {
      id: "contact",
      label: "連絡先・同意",
      total: 10,
      earned: 0,
      fields: [
        { key: "contact_info", label: "連絡先入力", hint: "コネクション成立後に共有", points: 5, done: nonEmpty(profile.contact_info) },
        { key: "consent", label: "第三者提供同意", hint: "オンボーディング完了で取得", points: 5, done: Boolean(extras.consentAt) },
      ],
    },
    {
      id: "tldv",
      label: "会話分析の蓄積",
      total: 10,
      earned: 0,
      fields: [
        { key: "tldv_1", label: "tl;dv 接続 (1回分析)", hint: "推薦精度 Lv2 へ", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 1 },
        { key: "tldv_5", label: "5回分析済み (Lv3)", hint: "高精度推薦が解禁", points: 5, hash: "/settings#tldv-connect", done: extras.analyzedCount >= 5 },
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

interface RawExtras {
  goals: number;
  offerings: number;
  consent_at: string | null;
  analyzed_count: number;
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
  const consentAt = extras?.consent_at ?? profile?.contact_sharing_consent_at ?? null;
  const analyzedCount = extras?.analyzed_count ?? 0;

  return useMemo(() => {
    if (!profile) return null;
    return calcDetailedCompleteness(profile, {
      goalsCount: goals,
      offeringsCount: offerings,
      consentAt,
      analyzedCount,
    });
  }, [profile, goals, offerings, consentAt, analyzedCount]);
}
