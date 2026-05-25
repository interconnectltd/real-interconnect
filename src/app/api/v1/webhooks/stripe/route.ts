import type { Stripe as StripeNS } from "stripe";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/api-helpers";

/**
 * Stripe Webhook 受信エンドポイント。
 *
 * 設計:
 *   - Stripe からの POST を verify (`stripe.webhooks.constructEvent`)
 *   - subscription.* と invoice.payment_succeeded を扱う
 *   - DB 更新は service_role (RLS bypass) で実施
 *   - middleware の publicPaths に `/api/v1/webhooks/` が含まれているので
 *     認証は要らない (Stripe 署名で代替)
 *
 * 紹介プログラム (00063) との連携:
 *   - invoice.payment_succeeded → handle_subscription_payment RPC
 *     → referrals.status='paying' + commissions INSERT
 *   - customer.subscription.deleted → handle_subscription_canceled RPC
 *     → referrals.status='churned'
 */

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[stripe.webhook] STRIPE_WEBHOOK_SECRET is not set");
    return jsonError(500, "WEBHOOK_NOT_CONFIGURED", "Webhook secret not set");
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonError(400, "BAD_REQUEST", "Missing stripe-signature header");
  }

  const rawBody = await request.text();

  let event: StripeNS.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.warn(
      "[stripe.webhook] signature verification failed:",
      err instanceof Error ? err.message : String(err),
    );
    return jsonError(400, "INVALID_SIGNATURE", "Webhook signature invalid");
  }

  const admin = await createServiceClient();

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeNS.Subscription;
        const userId = await resolveUserId(sub.customer, sub.metadata);
        if (!userId) break;

        const firstItem = sub.items.data[0];
        const periodStart = firstItem?.current_period_start ?? null;
        const periodEnd = firstItem?.current_period_end ?? null;

        await admin
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              stripe_subscription_id: sub.id,
              stripe_customer_id:
                typeof sub.customer === "string" ? sub.customer : sub.customer.id,
              stripe_price_id: firstItem?.price.id ?? "",
              status: sub.status,
              current_period_start: periodStart
                ? new Date(periodStart * 1000).toISOString()
                : null,
              current_period_end: periodEnd
                ? new Date(periodEnd * 1000).toISOString()
                : null,
              cancel_at_period_end: sub.cancel_at_period_end,
              canceled_at: sub.canceled_at
                ? new Date(sub.canceled_at * 1000).toISOString()
                : null,
              trial_end: sub.trial_end
                ? new Date(sub.trial_end * 1000).toISOString()
                : null,
            },
            { onConflict: "stripe_subscription_id" },
          );

        if (event.type === "customer.subscription.deleted") {
          await admin.rpc("handle_subscription_canceled", { p_user_id: userId });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as StripeNS.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;
        if (!customerId) break;

        const userId = await resolveUserId(customerId, null);
        if (!userId) break;

        const amount = invoice.amount_paid ?? 0;
        if (amount > 0) {
          await admin.rpc("handle_subscription_payment", {
            p_user_id: userId,
            p_amount_jpy: amount,
            p_stripe_invoice_id: invoice.id ?? "",
          });

          const subId =
            invoice.parent?.subscription_details?.subscription;
          const subscriptionId = typeof subId === "string" ? subId : subId?.id;

          if (subscriptionId) {
            await admin
              .from("subscriptions")
              .update({
                last_invoice_amount_jpy: amount,
                last_invoice_paid_at: new Date().toISOString(),
              })
              .eq("stripe_subscription_id", subscriptionId);
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as StripeNS.Charge;
        const customerId =
          typeof charge.customer === "string"
            ? charge.customer
            : charge.customer?.id;
        if (!customerId) break;
        const userId = await resolveUserId(customerId, null);
        if (!userId) break;

        await admin
          .from("referrals")
          .update({ status: "refunded", refunded_at: new Date().toISOString() })
          .eq("referred_user_id", userId)
          .in("status", ["paying", "signed_up"]);

        await admin
          .from("commissions")
          .update({ status: "reversed" })
          .eq("referral_id", await getReferralId(userId))
          .eq("status", "pending");
        break;
      }

      default:
        // ignore other events
        break;
    }
  } catch (e) {
    console.warn(
      "[stripe.webhook] handler failed:",
      e instanceof Error ? e.message : String(e),
      "event:",
      event.type,
    );
    return jsonError(500, "HANDLER_FAILED", "Webhook handler failed");
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveUserId(
  customer: string | StripeNS.Customer | StripeNS.DeletedCustomer,
  metadata: StripeNS.Metadata | null,
): Promise<string | null> {
  if (metadata?.user_id) return metadata.user_id;

  const customerId = typeof customer === "string" ? customer : customer.id;
  const admin = await createServiceClient();
  const { data } = await admin
    .from("user_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

async function getReferralId(userId: string): Promise<string> {
  const admin = await createServiceClient();
  const { data } = await admin
    .from("referrals")
    .select("id")
    .eq("referred_user_id", userId)
    .maybeSingle();
  return data?.id ?? "00000000-0000-0000-0000-000000000000";
}
