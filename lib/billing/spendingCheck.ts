import { getChargesInWindow } from "./ledger";
import { centsToDollars, dollarsToCents, ExecutionPriceRange } from "./pricing";
import { BillingAccount, BillingStatus } from "@/types";

export interface SpendCheckResult {
  allowed: boolean;
  reason?: string;
}

function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Statuses that block new live execution outright. `past_due` is
 * deliberately NOT included - spec #37's configurable grace period isn't
 * built yet, so the default favors uninterrupted service (allow access
 * during past_due) rather than guessing at a grace window. `trialing` and
 * `active` are always allowed.
 */
const BLOCKED_STATUSES: BillingStatus[] = ["canceled", "unpaid", "inactive"];

/**
 * The billing gate (spec #9-10, #36, #44) - called once per task, in live
 * mode only, before any provider is asked to do real (billable) work.
 * Never silently downgrades or continues past a violated limit - refuses
 * the task outright with a plain-language reason, same as the existing
 * execution-policy approval gate does for risk class.
 */
export async function checkSpendBeforeExecution(
  account: BillingAccount,
  estimate: ExecutionPriceRange,
  taskBudgetDollars: number | undefined,
  now: Date = new Date()
): Promise<SpendCheckResult> {
  if (BLOCKED_STATUSES.includes(account.status)) {
    return {
      allowed: false,
      reason: `Execution blocked: billing account status is "${account.status}". Update your payment information to continue.`,
    };
  }

  if (taskBudgetDollars != null) {
    const budgetCents = dollarsToCents(taskBudgetDollars);
    if (estimate.highCents > budgetCents) {
      return {
        allowed: false,
        reason: `Estimated execution price ($${centsToDollars(estimate.lowCents).toFixed(2)}-$${centsToDollars(estimate.highCents).toFixed(2)}) could exceed this task's $${taskBudgetDollars.toFixed(2)} budget.`,
      };
    }
  }

  const limits = account.spendingLimits;

  if (limits.maxPerTaskCents != null && estimate.highCents > limits.maxPerTaskCents) {
    return {
      allowed: false,
      reason: `Execution blocked: this task's estimated cost could exceed the $${centsToDollars(limits.maxPerTaskCents).toFixed(2)} per-task spending limit.`,
    };
  }

  if (limits.maxPerDayCents != null) {
    const spentToday = await getChargesInWindow(account.userId, startOfUtcDay(now), now.toISOString());
    if (spentToday + estimate.highCents > limits.maxPerDayCents) {
      return { allowed: false, reason: `Execution blocked: daily spending limit reached ($${centsToDollars(limits.maxPerDayCents).toFixed(2)}/day).` };
    }
  }

  if (limits.maxPerMonthCents != null) {
    const periodStart = account.currentPeriodStart ?? startOfUtcDay(now);
    const spentThisMonth = await getChargesInWindow(account.userId, periodStart, now.toISOString());
    if (spentThisMonth + estimate.highCents > limits.maxPerMonthCents) {
      return { allowed: false, reason: `Execution blocked: monthly spending limit reached ($${centsToDollars(limits.maxPerMonthCents).toFixed(2)}/month).` };
    }
  }

  return { allowed: true };
}
