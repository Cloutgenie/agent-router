import { getStripeClient } from "./client";
import { updateBillingAccount } from "@/lib/billing/account";
import { BillingAccount } from "@/types";

/**
 * Creates a Stripe customer once and reuses it for every future billing
 * action (spec #12) - never creates a duplicate for the same account.
 * Persists `stripeCustomerId` on the (single-tenant) BillingAccount
 * immediately, so a concurrent call sees the same id rather than racing to
 * create two customers.
 */
export async function ensureStripeCustomer(account: BillingAccount): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    metadata: { userId: account.userId, billingAccountId: account.id },
  });

  await updateBillingAccount({ stripeCustomerId: customer.id });
  return customer.id;
}
