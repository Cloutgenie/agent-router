import Stripe from "stripe";
import { BillingPlan } from "@/types";

/**
 * All Stripe SDK usage in this codebase goes through this file - nothing
 * outside `lib/billing/stripe/` should import the `stripe` package
 * directly (spec: "Keep Stripe logic isolated... do not scatter
 * Stripe-specific code across the app").
 *
 * UNVERIFIED AGAINST A REAL STRIPE ACCOUNT: this batch was built without
 * live Stripe test-mode credentials (the user chose to defer providing
 * them). Every other "real" integration in this codebase (Tavily, Apollo,
 * OpenAI, Browserbase) was built by confirming the real API shape via a
 * live call before writing final code, then live-verified end-to-end. This
 * one could not be - it's written from the documented, stable Stripe API
 * shape, with mocked-SDK unit tests covering this codebase's own logic
 * (idempotency, price-to-plan mapping, subscription-state sync), but no
 * call in this file has ever actually run against Stripe. Treat it as
 * reviewed-but-unverified until someone runs it with real keys.
 */

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Throws if called without STRIPE_SECRET_KEY set - callers must check `isStripeConfigured()` first, same pattern as every other real adapter's `configured` guard. */
export function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured - missing STRIPE_SECRET_KEY.");
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

/** The three subscription plans this app can actually sell through Stripe - "free" and "enterprise" never go through Checkout (enterprise is Contact Sales; free needs no payment). */
export type PurchasablePlan = Extract<BillingPlan, "starter" | "pro" | "business">;

export function priceIdForPlan(plan: PurchasablePlan): string | undefined {
  const envVar: Record<PurchasablePlan, string | undefined> = {
    starter: process.env.STRIPE_STARTER_PRICE_ID,
    pro: process.env.STRIPE_PRO_PRICE_ID,
    business: process.env.STRIPE_BUSINESS_PRICE_ID,
  };
  return envVar[plan];
}

/** Reverse lookup used to sync a plan from a Stripe subscription's price id (webhook handlers) - undefined for an unrecognized price, e.g. one created outside this app's configured plans. */
export function planForPriceId(priceId: string): PurchasablePlan | undefined {
  const plans: PurchasablePlan[] = ["starter", "pro", "business"];
  return plans.find((plan) => priceIdForPlan(plan) === priceId);
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
