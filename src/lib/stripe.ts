import Stripe from "stripe";

/**
 * Stripe server-side client (singleton).
 *
 * Notes:
 *   - `STRIPE_SECRET_KEY` is required at runtime. Throwing here ensures
 *     misconfiguration is caught immediately instead of silently degrading.
 *   - apiVersion を固定することで、Stripe 側のデフォルト version が変わって
 *     型 / 挙動が壊れる事故を防ぐ。SDK と整合する最新版に時々更新する想定。
 *   - サーバ専用 — Edge runtime ではなく Node runtime route から使うこと。
 *
 * 紹介プログラム (00063) と連携:
 *   - Checkout 成功 → webhook customer.subscription.created で
 *     referrals.status = 'paying' + commissions INSERT
 *   - 退会/返金 → status = 'churned' / 'refunded'
 */

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  // build 時にも env を見るが、空文字でも fail 出来るよう厳密判定
  // (production deploy で env 未設定を早期発見)
  if (process.env.NODE_ENV === "production") {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
  // dev は warn のみで起動継続 (Sara がまだ env 入れてない段階での起動を許容)
  console.warn(
    "[stripe] STRIPE_SECRET_KEY is not set. Billing endpoints will fail.",
  );
}

export const stripe = new Stripe(secret ?? "sk_test_placeholder", {
  apiVersion: "2026-04-22.dahlia",
  appInfo: { name: "INTERCONNECT", url: "https://inter-connect.app" },
});

export const STRIPE_PRICE_ID_STANDARD_MONTHLY =
  process.env.STRIPE_PRICE_ID_STANDARD_MONTHLY ?? "";

/**
 * デフォルトのコミッション率 (0.0000-1.0000)。
 * 将来 admin UI で代理店ごとに差し替え可能にする想定。
 */
export const DEFAULT_COMMISSION_RATE = 0.20;
