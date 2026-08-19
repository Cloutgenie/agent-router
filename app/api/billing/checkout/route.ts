import { NextRequest } from "next/server";
import { getBillingAccount } from "@/lib/billing/account";
import { isStripeConfigured, PurchasablePlan } from "@/lib/billing/stripe/client";
import { createCheckoutSession, MissingPriceIdError } from "@/lib/billing/stripe/checkout";
import { ensureStripeCustomer } from "@/lib/billing/stripe/customer";

export const dynamic = "force-dynamic";

const PURCHASABLE_PLANS: PurchasablePlan[] = ["starter", "pro", "business"];

/** POST /api/billing/checkout (spec #11) - creates a Stripe Checkout Session and returns its URL for the client to redirect to. Never trust the redirect back as proof of payment - subscription state comes from webhooks only. */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return Response.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = body?.plan;
  if (!PURCHASABLE_PLANS.includes(plan as PurchasablePlan)) {
    return Response.json({ error: `plan must be one of: ${PURCHASABLE_PLANS.join(", ")}` }, { status: 400 });
  }

  try {
    const account = await getBillingAccount();
    const customerId = await ensureStripeCustomer(account);
    const session = await createCheckoutSession(plan as PurchasablePlan, customerId);
    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof MissingPriceIdError) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    return Response.json({ error: err instanceof Error ? err.message : "Checkout failed" }, { status: 502 });
  }
}
