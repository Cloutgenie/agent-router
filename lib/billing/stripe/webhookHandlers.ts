import Stripe from "stripe";
import { getBillingAccount, updateBillingAccount } from "@/lib/billing/account";
import { ensurePeriodCreditProvisioned } from "@/lib/billing/usage";
import { planForPriceId } from "./client";
import { BillingStatus } from "@/types";

/**
 * Handled events (spec #13) - deliberately a subset of the spec's full
 * list, per its own "only implement events genuinely needed" instruction:
 *
 *  - checkout.session.completed / customer.subscription.created|updated|
 *    deleted: the actual plan/status/period sync - Stripe is the source of
 *    truth (spec #14), this app's BillingAccount just mirrors it.
 *  - invoice.paid / invoice.payment_failed: lightweight triggers keyed
 *    only by customer id (provision the period's included credit; mark
 *    past_due) - the account's period dates are already kept current by
 *    the subscription events above, so these don't need to parse an
 *    invoice's own period fields.
 *  - invoice.created, invoice.finalized, payment_intent.succeeded/failed:
 *    not handled - nothing in this app's UI or economics reads anything
 *    these would provide that the events above don't already cover.
 *    Stripe requires a 200 response for event types it delivers whether or
 *    not the receiver acts on them; the webhook route returns one for any
 *    unhandled type rather than erroring.
 *
 * Every handler is safe to run twice (idempotent at the data level, not
 * just the event-id-dedup level in the webhook route) since it always sets
 * absolute state from the Stripe object, never increments/appends.
 */

const STRIPE_STATUS_MAP: Record<Stripe.Subscription.Status, BillingStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "inactive",
  incomplete_expired: "inactive",
  paused: "inactive",
};

function mapStatus(status: Stripe.Subscription.Status): BillingStatus {
  return STRIPE_STATUS_MAP[status] ?? "inactive";
}

/** Only acts if this event's customer matches the (single-tenant) account's stored Stripe customer id - a real multi-tenant version would look the account up BY customer id instead of assuming there's exactly one. */
async function forThisAccount(customerId: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  const id = typeof customerId === "string" ? customerId : customerId?.id;
  if (!id) return null;
  const account = await getBillingAccount();
  return account.stripeCustomerId === id ? account : null;
}

async function syncFromSubscription(subscription: Stripe.Subscription): Promise<void> {
  const account = await forThisAccount(subscription.customer);
  if (!account) return;

  const item = subscription.items.data[0];
  const plan = item ? planForPriceId(item.price.id) : undefined;

  await updateBillingAccount({
    subscriptionId: subscription.id,
    status: mapStatus(subscription.status),
    ...(plan ? { plan } : {}), // an unrecognized price id leaves the account's current plan untouched rather than guessing
    ...(item ? { currentPeriodStart: new Date(item.current_period_start * 1000).toISOString() } : {}),
    ...(item ? { currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString() } : {}),
  });
}

export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const account = await forThisAccount(session.customer);
  if (!account) return;
  if (typeof session.subscription === "string") {
    await updateBillingAccount({ subscriptionId: session.subscription });
  }
}

export async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  await syncFromSubscription(subscription);
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  await syncFromSubscription(subscription);
}

/** Preserves account/task data (spec #38) - only entitlements change, via `status`. */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const account = await forThisAccount(subscription.customer);
  if (!account) return;
  await updateBillingAccount({ status: "canceled" });
}

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const account = await forThisAccount(invoice.customer);
  if (!account) return;
  await ensurePeriodCreditProvisioned(account);
}

/** Configurable grace period is a future refinement (spec #37) - for now this only flips status; the pipeline's billing gate already blocks live execution for any non-active/trialing status. */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const account = await forThisAccount(invoice.customer);
  if (!account) return;
  await updateBillingAccount({ status: "past_due" });
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(event.data.object);
    case "customer.subscription.created":
      return handleSubscriptionCreated(event.data.object);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event.data.object);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event.data.object);
    case "invoice.paid":
      return handleInvoicePaid(event.data.object);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data.object);
    default:
      return; // acknowledged but not acted on - see doc comment above
  }
}
