import { getBillingAccount } from "@/lib/billing/account";
import { isStripeConfigured } from "@/lib/billing/stripe/client";
import { createPortalSession } from "@/lib/billing/stripe/portal";

export const dynamic = "force-dynamic";

/** POST /api/billing/portal (spec #22) - Stripe-hosted portal for payment method, invoices, and subscription management. */
export async function POST() {
  if (!isStripeConfigured()) {
    return Response.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const account = await getBillingAccount();
  if (!account.stripeCustomerId) {
    return Response.json({ error: "No Stripe customer yet - subscribe to a plan first." }, { status: 400 });
  }

  try {
    const session = await createPortalSession(account.stripeCustomerId);
    return Response.json({ url: session.url });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not open billing portal" }, { status: 502 });
  }
}
