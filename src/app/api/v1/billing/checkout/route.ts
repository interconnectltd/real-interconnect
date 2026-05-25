import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { getStripe, STRIPE_PRICE_ID_STANDARD_MONTHLY } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);
    if (!STRIPE_PRICE_ID_STANDARD_MONTHLY) {
      return jsonError(500, "PRICE_NOT_CONFIGURED", "料金プランが未設定です");
    }
    const stripe = getStripe();

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("stripe_customer_id, email, name")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) {
      return jsonError(404, "PROFILE_NOT_FOUND", "プロフィールが見つかりません");
    }

    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        name: profile.name,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;

      const admin = await createServiceClient();
      await admin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // dev/prod 両対応: request URL から origin を取得
    // (NEXT_PUBLIC_SITE_URL が未設定でも動くようにする)
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID_STANDARD_MONTHLY, quantity: 1 }],
      success_url: `${base}/settings?checkout=success`,
      cancel_url: `${base}/settings?checkout=cancel`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { user_id: user.id },
      },
      client_reference_id: user.id,
    });

    return json({ url: session.url });
  } catch (e) {
    return handleApiError(e);
  }
}
