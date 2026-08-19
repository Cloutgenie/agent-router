import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingAccount } from "@/types";

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

let account: BillingAccount;
let chargedThisPeriod: number;
let adjustmentsThisPeriod: number;

vi.mock("@/lib/billing/account", () => ({
  getBillingAccount: vi.fn(async () => account),
}));

vi.mock("@/lib/billing/ledger", () => ({
  getChargesInWindow: vi.fn(async () => chargedThisPeriod),
  getAdjustmentsInWindow: vi.fn(async () => adjustmentsThisPeriod),
}));

describe("getBillingStatusSummary", () => {
  beforeEach(() => {
    account = makeAccount();
    chargedThisPeriod = 0;
    adjustmentsThisPeriod = 0;
  });

  it("reports full remaining balance and zero overage before any usage", async () => {
    const { getBillingStatusSummary } = await import("@/lib/billing/status");
    const summary = await getBillingStatusSummary();
    expect(summary.includedExecutionCents).toBe(4000); // pro plan
    expect(summary.usedExecutionCents).toBe(0);
    expect(summary.remainingExecutionCents).toBe(4000);
    expect(summary.overageCents).toBe(0);
  });

  it("splits usage between included and overage once charges exceed the included allowance", async () => {
    chargedThisPeriod = 4500; // pro plan included = 4000
    const { getBillingStatusSummary } = await import("@/lib/billing/status");
    const summary = await getBillingStatusSummary();
    expect(summary.usedExecutionCents).toBe(4000);
    expect(summary.remainingExecutionCents).toBe(0);
    expect(summary.overageCents).toBe(500);
  });

  it("reports unlimited (null) for the enterprise plan rather than a raw Infinity", async () => {
    account = makeAccount({ plan: "enterprise" });
    chargedThisPeriod = 100000;
    const { getBillingStatusSummary } = await import("@/lib/billing/status");
    const summary = await getBillingStatusSummary();
    expect(summary.includedExecutionCents).toBeNull();
    expect(summary.remainingExecutionCents).toBeNull();
    expect(summary.overageCents).toBe(0);
    expect(summary.usedExecutionCents).toBe(100000);
  });

  it("reflects a manual admin credit grant as additional remaining balance, on top of the plan's base allowance", async () => {
    adjustmentsThisPeriod = 1000; // e.g. a $10 goodwill grant
    const { getBillingStatusSummary } = await import("@/lib/billing/status");
    const summary = await getBillingStatusSummary();
    expect(summary.includedExecutionCents).toBe(5000); // 4000 plan + 1000 grant
    expect(summary.remainingExecutionCents).toBe(5000);
  });

  it("reflects a manual admin credit removal as less remaining balance, never below zero", async () => {
    adjustmentsThisPeriod = -4500; // removed more than the plan's whole allowance
    const { getBillingStatusSummary } = await import("@/lib/billing/status");
    const summary = await getBillingStatusSummary();
    expect(summary.includedExecutionCents).toBe(0);
    expect(summary.remainingExecutionCents).toBe(0);
  });
});
