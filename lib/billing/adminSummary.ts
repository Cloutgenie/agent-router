import { getBillingAccount } from "./account";
import { planDefinition } from "./plans";
import { BillingStatusSummary, getBillingStatusSummary } from "./status";
import { getAllHistoryTasks } from "@/lib/history/store";
import { BillingAccount } from "@/types";

/**
 * Admin billing view (spec #35): plan, status, usage, and real
 * revenue/cost/margin for the current billing period. Revenue and cost
 * come from `Task.economics` (already computed per task by
 * lib/billing/usage.ts) summed over tasks created within the account's
 * current period - not re-derived or estimated here.
 */
export interface AdminBillingSummary {
  account: BillingAccount;
  status: BillingStatusSummary;
  /** Current state only, not a historical count - this app doesn't persist a log of individual payment-failure events, just the resulting account status. */
  hasFailedPayment: boolean;
  subscriptionRevenueCents: number;
  executionRevenueCents: number;
  providerCostCents: number;
  grossRevenueCents: number;
  grossMarginCents: number;
  billedTaskCount: number;
}

const REVENUE_GENERATING_STATUSES = ["active", "trialing"];

export async function getAdminBillingSummary(now: Date = new Date()): Promise<AdminBillingSummary> {
  const [account, status, tasks] = await Promise.all([getBillingAccount(), getBillingStatusSummary(now), getAllHistoryTasks()]);

  const periodStart = account.currentPeriodStart ?? new Date(0).toISOString();
  const periodEnd = account.currentPeriodEnd ?? now.toISOString();
  const billedTasks = tasks.filter((t) => t.economics && t.created_at >= periodStart && t.created_at <= periodEnd);

  const executionRevenueCents = billedTasks.reduce((sum, t) => sum + t.economics!.customerPriceCents, 0);
  const providerCostCents = billedTasks.reduce((sum, t) => sum + t.economics!.providerCostCents, 0);
  const grossMarginCents = billedTasks.reduce((sum, t) => sum + t.economics!.grossMarginCents, 0);
  const subscriptionRevenueCents = REVENUE_GENERATING_STATUSES.includes(account.status) ? planDefinition(account.plan).priceCents : 0;

  return {
    account,
    status,
    hasFailedPayment: account.status === "past_due" || account.status === "unpaid",
    subscriptionRevenueCents,
    executionRevenueCents,
    providerCostCents,
    grossRevenueCents: subscriptionRevenueCents + executionRevenueCents,
    grossMarginCents: subscriptionRevenueCents + grossMarginCents,
    billedTaskCount: billedTasks.length,
  };
}
