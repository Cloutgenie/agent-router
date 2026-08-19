import { appUrl, getStripeClient, priceIdForPlan, PurchasablePlan } from "./client";

export class MissingPriceIdError extends Error {
  constructor(plan: PurchasablePlan) {
    super(`No Stripe price id configured for the "${plan}" plan - set STRIPE_${plan.toUpperCase()}_PRICE_ID.`);
  }
}

/**
 * Creates a Stripe Checkout Session for a subscription plan (spec #11).
 * The caller redirects the customer to the returned URL - Stripe hosts the
 * entire payment form, so no card details ever pass through this app.
 */
export async function createCheckoutSession(plan: PurchasablePlan, customerId: string): Promise<{ url: string | null }> {
  const priceId = priceIdForPlan(plan);
  if (!priceId) throw new MissingPriceIdError(plan);

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl()}/billing/success`,
    cancel_url: `${appUrl()}/billing/canceled`,
    metadata: { plan },
  });

  return { url: session.url };
}
