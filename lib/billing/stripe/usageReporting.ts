import { getStripeClient, isStripeConfigured } from "./client";

/**
 * Metered overage reporting (spec #17's usage-handling step 6, #20).
 * Reports through Stripe's current Billing Meters API
 * (`stripe.billing.meterEvents.create`) - confirmed against the installed
 * SDK's own type definitions, not assumed from memory: the older,
 * subscription-item-scoped `createUsageRecord` API this codebase's
 * training data might otherwise suggest is gone from this SDK version. A
 * meter event correlates to billing by customer id plus the meter's
 * configured `event_name` - not a price id or subscription item id - so
 * `STRIPE_EXECUTION_USAGE_PRICE_ID` (reserved since the core-architecture
 * batch for a future "attach the metered price to the subscription at
 * Checkout" step, still not built) is a different concern from the meter
 * event name this file actually needs.
 *
 * UNVERIFIED against a real Stripe account/meter - see
 * lib/billing/stripe/client.ts's doc comment for why. Reporting is
 * best-effort: every call site treats a failure here as non-fatal (a
 * console.warn, never a thrown error that could fail the task or hide the
 * receipt from the user) - the local ledger is always the source of truth
 * for what the customer actually owes, Stripe reporting is a downstream
 * sync, not a dependency.
 */

export function isMeteredReportingConfigured(): boolean {
  return isStripeConfigured() && Boolean(process.env.STRIPE_EXECUTION_METER_EVENT_NAME);
}

export interface ReportOverageInput {
  customerId: string;
  overageCents: number;
  taskId: string;
}

/**
 * Reports one task's overage as a single meter event. Idempotent via
 * Stripe's own event `identifier` (the task id) - Stripe dedupes by
 * identifier within a rolling ~24h window, so a retried call for the same
 * task is never double-counted on Stripe's side either.
 *
 * The event's `value` is the overage in cents - the corresponding Stripe
 * Price must be configured to charge per-cent-unit for this to bill the
 * correct dollar amount. This convention is documented here because it
 * cannot be confirmed against a real configured meter/price.
 */
export async function reportOverageToStripe(input: ReportOverageInput): Promise<void> {
  if (input.overageCents <= 0) return;
  if (!isMeteredReportingConfigured()) return;

  const stripe = getStripeClient();
  await stripe.billing.meterEvents.create({
    event_name: process.env.STRIPE_EXECUTION_METER_EVENT_NAME as string,
    identifier: `overage-${input.taskId}`,
    payload: {
      stripe_customer_id: input.customerId,
      value: String(input.overageCents),
    },
  });
}
