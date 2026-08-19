import { getBillingAccount } from "./account";
import { getEntitlements } from "./entitlements";
import { getChargesInWindow } from "./ledger";
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
  const includedRaw = getEntitlements(account.plan).raw.includedExecutionCents;
  const unlimited = !Number.isFinite(includedRaw);
  const periodStart = account.currentPeriodStart ?? now.toISOString();
  const chargedThisPeriod = await getChargesInWindow(account.userId, periodStart, now.toISOString());

  return {
    plan: account.plan,
    status: account.status,
    includedExecutionCents: unlimited ? null : includedRaw,
    usedExecutionCents: unlimited ? chargedThisPeriod : Math.min(chargedThisPeriod, includedRaw),
    remainingExecutionCents: unlimited ? null : Math.max(0, includedRaw - chargedThisPeriod),
    overageCents: unlimited ? 0 : Math.max(0, chargedThisPeriod - includedRaw),
    currentPeriodStart: account.currentPeriodStart,
    currentPeriodEnd: account.currentPeriodEnd,
    spendingLimits: account.spendingLimits,
  };
}
