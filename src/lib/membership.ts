/**
 * 会員プラン (membership tier) 判定の単一情報源。
 *
 * 設計:
 *   - manual_plan (user_profiles.manual_plan) が NULL でなければ Stripe より優先
 *   - manual_plan = 'monitor' → 有料相当のフルアクセス
 *   - manual_plan = 'free' → 明示的無料 (Stripe active でも free 扱い)
 *   - manual_plan = null → subscriptions.status で判定
 *
 * 全てのプラン判定は必ずこの関数を経由すること。直接 status を判定するコードを
 * 書くと manual_plan を考慮し忘れて課金回避バグになる。
 */

export type MembershipTier = "monitor" | "paid" | "free";
export type ManualPlan = "monitor" | "free" | null;

export interface ResolveTierInput {
  manual_plan: ManualPlan;
  subscription_status?: string | null;
  current_period_end?: string | null;
}

export function resolveMembershipTier(input: ResolveTierInput): MembershipTier {
  if (input.manual_plan === "monitor") return "monitor";
  if (input.manual_plan === "free") return "free";

  const status = input.subscription_status;
  const isStripeActive =
    (status === "active" || status === "trialing") &&
    (!input.current_period_end ||
      new Date(input.current_period_end).getTime() >= Date.now());

  return isStripeActive ? "paid" : "free";
}

/** フル機能 (有料機能含む) にアクセス可能か */
export function hasFullAccess(tier: MembershipTier): boolean {
  return tier === "monitor" || tier === "paid";
}

/** 表示用ラベル */
export function tierLabel(tier: MembershipTier): string {
  switch (tier) {
    case "monitor":
      return "モニター会員";
    case "paid":
      return "有料会員";
    case "free":
      return "無料会員";
  }
}
