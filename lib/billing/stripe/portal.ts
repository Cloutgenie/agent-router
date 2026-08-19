import { appUrl, getStripeClient } from "./client";

/** Stripe-hosted Billing Portal session (spec #22) - payment method, invoices, and subscription management all happen inside Stripe's own UI, never re-implemented here. */
export async function createPortalSession(customerId: string): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/settings/billing`,
  });
  return { url: session.url };
}
