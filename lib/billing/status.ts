import { getBillingAccount } from "./account";
import { getEntitlements } from "./entitlements";
import { getAdjustmentsInWindow, getChargesInWindow } from "./ledger";
import { BillingPlan, BillingStatus, SpendingLimits } from "@/types";

/**
 * Normalized billing state (spec #43) - what `/settings/billing` and
 * `GET /api/billing/status` both read from, so the UI never has to
 * reconstruct "used vs. remaining vs. overage" from raw ledger entries
 * itself. `null` on the two nullable fields means "unlimited" (enterprise's
 * included execution allowance is `Infinity` internally, which doesn't
 * survive JSON - `null` is the documented wire representation instead).
 */
export interface BillingStatusSummary {
  plan: BillingPlan;
  status: BillingStatus;
  includedExecutionCents: number | null;
  usedExecutionCents: number;
  remainingExecutionCents: number | null;
  overageCents: number;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  spendingLimits: SpendingLimits;
}

export async function getBillingStatusSummary(now: Date = new Date()): Promise<BillingStatusSummary> {
  const account = await getBillingAccount();
  const planIncludedCents = getEntitlements(account.plan).raw.includedExecutionCents;
  const unlimited = !Number.isFinite(planIncludedCents);
  const periodStart = account.currentPeriodStart ?? now.toISOString();
  const periodEndIso = now.toISOString();
  const chargedThisPeriod = await getChargesInWindow(account.userId, periodStart, periodEndIso);

  // A manual admin grant/removal (lib/billing/adminActions.ts) changes how
  // much execution balance the customer actually has this period, on top
  // of the plan's base allowance - without this, an admin credit would be
  // recorded correctly in the ledger but never show up as more "remaining"
  // here (a real gap caught live-testing the admin credit form).
  const adjustmentsThisPeriod = unlimited ? 0 : await getAdjustmentsInWindow(account.userId, periodStart, periodEndIso);
  const effectiveIncludedCents = unlimited ? Infinity : Math.max(0, planIncludedCents + adjustmentsThisPeriod);

  return {
    plan: account.plan,
    status: account.status,
    includedExecutionCents: unlimited ? null : effectiveIncludedCents,
    usedExecutionCents: unlimited ? chargedThisPeriod : Math.min(chargedThisPeriod, effectiveIncludedCents),
    remainingExecutionCents: unlimited ? null : Math.max(0, effectiveIncludedCents - chargedThisPeriod),
    overageCents: unlimited ? 0 : Math.max(0, chargedThisPeriod - effectiveIncludedCents),
    currentPeriodStart: account.currentPeriodStart,
    currentPeriodEnd: account.currentPeriodEnd,
    spendingLimits: account.spendingLimits,
  };
}
