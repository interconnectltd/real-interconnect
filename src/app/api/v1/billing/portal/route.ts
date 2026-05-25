import { withAuth, json, jsonError, handleApiError } from "@/lib/api-helpers";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const { user, supabase } = await withAuth(request);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const stripe = getStripe();

    if (!profile?.stripe_customer_id) {
      return jsonError(
        400,
        "NO_CUSTOMER",
        "Stripe アカウントがまだ作成されていません。先にプランに申し込んでください。",
      );
    }

    const base =
      process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${base}/settings`,
    });

    return json({ url: session.url });
  } catch (e) {
    return handleApiError(e);
  }
}
