import { describe, expect, it, vi } from "vitest";
import { checkSpendBeforeExecution } from "@/lib/billing/spendingCheck";
import { BillingAccount } from "@/types";

vi.mock("@/lib/billing/ledger", () => ({
  getChargesInWindow: vi.fn(async () => 0),
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

describe("checkSpendBeforeExecution", () => {
  it("allows execution when nothing is configured", async () => {
    const result = await checkSpendBeforeExecution(makeAccount(), { lowCents: 100, highCents: 200 }, undefined);
    expect(result.allowed).toBe(true);
  });

  it("blocks when the estimate's high end exceeds the task's own hard budget", async () => {
    const result = await checkSpendBeforeExecution(makeAccount(), { lowCents: 100, highCents: 600 }, 5);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget/);
  });

  it("does not block when the estimate stays within the task budget", async () => {
    const result = await checkSpendBeforeExecution(makeAccount(), { lowCents: 100, highCents: 400 }, 5);
    expect(result.allowed).toBe(true);
  });

  it("blocks when the estimate exceeds the account's per-task spending limit", async () => {
    const account = makeAccount({ spendingLimits: { maxPerTaskCents: 300 } });
    const result = await checkSpendBeforeExecution(account, { lowCents: 100, highCents: 400 }, undefined);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/per-task/);
  });

  it("blocks when today's spend plus the new estimate would exceed the daily limit", async () => {
    const ledger = await import("@/lib/billing/ledger");
    vi.mocked(ledger.getChargesInWindow).mockResolvedValueOnce(4800); // spent today
    const account = makeAccount({ spendingLimits: { maxPerDayCents: 5000 } });
    const result = await checkSpendBeforeExecution(account, { lowCents: 100, highCents: 300 }, undefined);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily/);
  });

  it("blocks when this period's spend plus the new estimate would exceed the monthly limit", async () => {
    const ledger = await import("@/lib/billing/ledger");
    vi.mocked(ledger.getChargesInWindow).mockResolvedValueOnce(0).mockResolvedValueOnce(39500); // daily ok, monthly close to limit
    const account = makeAccount({ spendingLimits: { maxPerDayCents: 999999, maxPerMonthCents: 40000 } });
    const result = await checkSpendBeforeExecution(account, { lowCents: 100, highCents: 1000 }, undefined);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/monthly/);
  });
});
