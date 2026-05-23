/**
 * 代理店プログラム共通ユーティリティ
 *
 * - ランク計算 (DB の compute_agency_rank と同じロジックを TS で持つ。表示時の即時計算用)
 * - referral code 生成 (8 文字 base32 風)
 * - IP の SHA-256 hash (個情法/GDPR 対策で生 IP を残さない)
 */

import { createHash, randomBytes } from "node:crypto";

export type AgencyStatus = "pending" | "approved" | "suspended" | "rejected";
export type AgencyRank = "bronze" | "silver" | "gold" | "platinum" | "diamond";
export type ReferralStatus = "signed_up" | "paying" | "churned" | "refunded";
export type ApplicationStatus = "pending" | "approved" | "rejected";

export const RANK_THRESHOLDS: Array<{ rank: AgencyRank; min: number }> = [
  { rank: "diamond", min: 50 },
  { rank: "platinum", min: 20 },
  { rank: "gold", min: 10 },
  { rank: "silver", min: 5 },
  { rank: "bronze", min: 0 },
];

export const RANK_LABEL: Record<AgencyRank, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

export const RANK_COLOR: Record<AgencyRank, string> = {
  bronze: "amber",
  silver: "slate",
  gold: "yellow",
  platinum: "sky",
  diamond: "violet",
};

export function computeAgencyRank(totalReferrals: number): AgencyRank {
  for (const { rank, min } of RANK_THRESHOLDS) {
    if (totalReferrals >= min) return rank;
  }
  return "bronze";
}

export function nextRankInfo(totalReferrals: number): {
  current: AgencyRank;
  next: AgencyRank | null;
  remaining: number;
} {
  const current = computeAgencyRank(totalReferrals);
  const ascending = [...RANK_THRESHOLDS].reverse(); // bronze → diamond
  const idx = ascending.findIndex((t) => t.rank === current);
  const next = ascending[idx + 1];
  if (!next) return { current, next: null, remaining: 0 };
  return { current, next: next.rank, remaining: next.min - totalReferrals };
}

/**
 * 8 文字の URL 安全な紹介コード生成。
 * base32 (Crockford) 風: 紛らわしい 0/O/1/I/L を除外。
 *
 * 衝突確率: 32^8 ≈ 1.1T → 数万件発行でも実用衝突なし。
 * DB の UNIQUE 制約で最終チェック (発生時は再生成)。
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateReferralCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * IP アドレスを SHA-256 で hash 化。生 IP を DB に残さない。
 * salt は環境変数 (REFERRAL_IP_SALT) から取得。未設定時はビルドプロセス固有の固定値で fallback。
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.REFERRAL_IP_SALT ?? "interconnect-referral-default-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
