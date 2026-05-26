import Stripe from "stripe";

/**
 * Stripe server-side client (lazy singleton).
 *
 * 設計上の注意:
 *   - `new Stripe(secret, ...)` を **モジュール top-level で呼ばない**。
 *     Next.js (Turbopack) のビルド時 page data collection 段階で
 *     全 route の module evaluate が走るため、secret が空だと
 *     `new Stripe("")` が "Neither apiKey nor config.authenticator provided"
 *     を投げてビルドが失敗する → Stripe を使わないページまで本番から消える。
 *   - 解決: 各 route が **request 時に** `getStripe()` を呼ぶことで遅延初期化。
 *     env 未設定なら handleApiError() で 500 を返すだけで他には波及しない。
 *
 * 紹介プログラム (00063) と連携:
 *   - Checkout 成功 → webhook customer.subscription.created で
 *     referrals.status = 'paying' + commissions INSERT
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it in environment variables to enable billing.",
    );
  }
  _stripe = new Stripe(secret, {
    apiVersion: "2026-04-22.dahlia",
    appInfo: { name: "INTERCONNECT", url: "https://inter-connect.app" },
  });
  return _stripe;
}

export const STRIPE_PRICE_ID_STANDARD_MONTHLY =
  process.env.STRIPE_PRICE_ID_STANDARD_MONTHLY ?? "";

/**
 * デフォルトのコミッション率 (0.0000-1.0000)。
 * admin UI で代理店ごとに差し替え可能 (agencies.commission_rate)。
 */
export const DEFAULT_COMMISSION_RATE = 0.20;
