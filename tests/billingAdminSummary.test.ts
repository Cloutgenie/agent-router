import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingAccount, Task, TaskEconomics } from "@/types";
import { makeTask } from "./fixtures";

let account: BillingAccount;
let tasks: Task[];

vi.mock("@/lib/billing/account", () => ({
  getBillingAccount: () => account,
}));

vi.mock("@/lib/billing/status", () => ({
  getBillingStatusSummary: async () => ({
    plan: account.plan,
    status: account.status,
    includedExecutionCents: 4000,
    usedExecutionCents: 0,
    remainingExecutionCents: 4000,
    overageCents: 0,
    currentPeriodStart: account.currentPeriodStart,
    currentPeriodEnd: account.currentPeriodEnd,
    spendingLimits: account.spendingLimits,
  }),
}));

vi.mock("@/lib/history/store", () => ({
  getAllHistoryTasks: async () => tasks,
}));

function makeAccount(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: "acct-1",
    userId: "u1",
    stripeCustomerId: null,
    subscriptionId: null,
    plan: "pro",
    status: "active",
    currentPeriodStart: "2026-08-01T00:00:00.000Z",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    spendingLimits: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEconomics(overrides: Partial<TaskEconomics> = {}): TaskEconomics {
  return {
    billingStatus: "billable",
    customerPriceCents: 200,
    includedCreditAppliedCents: 200,
    overageAmountCents: 0,
    providerCostCents: 100,
    verificationCostCents: 0,
    platformCostCents: 100,
    grossMarginCents: 100,
    ...overrides,
  };
}

describe("getAdminBillingSummary", () => {
  beforeEach(() => {
    account = makeAccount();
    tasks = [];
  });

  it("sums execution revenue, provider cost, and margin only from billed tasks inside the current period", async () => {
    tasks = [
      makeTask({ created_at: "2026-08-10T00:00:00.000Z", economics: makeEconomics({ customerPriceCents: 300, providerCostCents: 150, grossMarginCents: 150 }) }),
      makeTask({ created_at: "2026-08-15T00:00:00.000Z", economics: makeEconomics({ customerPriceCents: 200, providerCostCents: 100, grossMarginCents: 100 }) }),
      makeTask({ created_at: "2026-07-01T00:00:00.000Z", economics: makeEconomics({ customerPriceCents: 900 }) }), // before the period - excluded
      makeTask({ created_at: "2026-08-12T00:00:00.000Z", economics: undefined }), // demo-mode task, never billed - excluded
    ];

    const summary = await import("@/lib/billing/adminSummary").then((m) => m.getAdminBillingSummary());
    expect(summary.executionRevenueCents).toBe(500);
    expect(summary.providerCostCents).toBe(250);
    expect(summary.billedTaskCount).toBe(2);
  });

  it("includes the subscription price in gross revenue only when the account is active or trialing", async () => {
    account = makeAccount({ status: "active", plan: "pro" });
    const active = await import("@/lib/billing/adminSummary").then((m) => m.getAdminBillingSummary());
    expect(active.subscriptionRevenueCents).toBe(14900);

    account = makeAccount({ status: "canceled" });
    const canceled = await import("@/lib/billing/adminSummary").then((m) => m.getAdminBillingSummary());
    expect(canceled.subscriptionRevenueCents).toBe(0);
  });

  it("flags hasFailedPayment only for past_due/unpaid statuses", async () => {
    account = makeAccount({ status: "past_due" });
    expect((await import("@/lib/billing/adminSummary").then((m) => m.getAdminBillingSummary())).hasFailedPayment).toBe(true);

    account = makeAccount({ status: "active" });
    expect((await import("@/lib/billing/adminSummary").then((m) => m.getAdminBillingSummary())).hasFailedPayment).toBe(false);
  });
});
