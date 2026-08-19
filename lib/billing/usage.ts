import { appendLedgerEntry, getLedgerBalanceCents } from "./ledger";
import { getEntitlements } from "./entitlements";
import { BillingAccount, ExecutionPrice, TaskBillingStatus, TaskEconomics } from "@/types";

/**
 * Provisions the plan's included execution credit for the current billing
 * period (spec #15), idempotent via a synthetic `taskId` of
 * `period-credit:<periodStart>` - `appendLedgerEntry` already dedupes on
 * taskId+type, so calling this once per task run is safe; only the first
 * call in a given period actually writes anything. A real Stripe batch
 * would trigger this from `invoice.paid` using the real invoice id instead
 * of `currentPeriodStart` - same mechanism, different trigger.
 */
export async function ensurePeriodCreditProvisioned(account: BillingAccount): Promise<void> {
  const includedCents = getEntitlements(account.plan).raw.includedExecutionCents;
  if (!Number.isFinite(includedCents) || includedCents <= 0) return; // free plan or unbounded enterprise - nothing to provision
  await appendLedgerEntry({
    userId: account.userId,
    taskId: `period-credit:${account.currentPeriodStart ?? "unknown"}`,
    type: "included_credit",
    amountCents: includedCents,
    metadata: { plan: account.plan, periodStart: account.currentPeriodStart, periodEnd: account.currentPeriodEnd },
  });
}

/**
 * Customer-friendly failed/partial-execution billing (spec #18-19): a task
 * that produced nothing usable is never charged full price. This is one
 * configurable policy, not the only permanent rule - a future admin-facing
 * billing policy setting could replace the flat 50% partial rate.
 */
function chargeableCents(billingStatus: TaskBillingStatus, fullPriceCents: number): number {
  if (billingStatus === "not_billable" || billingStatus === "refunded") return 0;
  if (billingStatus === "partially_billable") return Math.round(fullPriceCents * 0.5);
  return fullPriceCents;
}

export interface RecordUsageInput {
  userId: string;
  taskId: string;
  billingStatus: TaskBillingStatus;
  price: ExecutionPrice;
}

/**
 * Finalizes billing for one completed task (spec #16-17): writes exactly
 * one immutable ledger entry (idempotent by taskId+type - a retried
 * finalization or duplicate call never double-charges), consumes included
 * balance first, and reports whatever spilled over as overage. The ledger
 * itself - not this function's return value - is the durable record;
 * `TaskEconomics` here is a convenience summary for the task's own page.
 */
export async function recordExecutionUsage(input: RecordUsageInput): Promise<TaskEconomics> {
  const fullPriceCents = input.price.actualCustomerPriceCents ?? input.price.estimatedCustomerPriceCents;
  const customerPriceCents = chargeableCents(input.billingStatus, fullPriceCents);

  const balanceBeforeCents = Math.max(0, await getLedgerBalanceCents(input.userId));
  const overageCents = Math.max(0, customerPriceCents - balanceBeforeCents);
  const includedCreditAppliedCents = customerPriceCents - overageCents;

  const providerCostCents = input.price.actualProviderCostCents ?? input.price.estimatedProviderCostCents;

  await appendLedgerEntry({
    userId: input.userId,
    taskId: input.taskId,
    type: "execution_charge",
    amountCents: -customerPriceCents,
    metadata: {
      billingStatus: input.billingStatus,
      overageCents,
      providerCostCents,
      fullPriceCents,
    },
  });

  return {
    billingStatus: input.billingStatus,
    customerPriceCents,
    includedCreditAppliedCents,
    overageAmountCents: overageCents,
    providerCostCents,
    verificationCostCents: input.price.verificationCostCents,
    platformCostCents: input.price.platformFeeCents,
    grossMarginCents: customerPriceCents - providerCostCents - input.price.verificationCostCents,
  };
}
