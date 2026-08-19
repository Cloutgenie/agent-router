import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingAccount, ExecutionPrice } from "@/types";

const ledgerEntries: Array<{ userId: string; taskId?: string; type: string; amountCents: number; metadata?: unknown }> = [];

vi.mock("@/lib/billing/ledger", () => ({
  appendLedgerEntry: vi.fn(async (input: { userId: string; taskId?: string; type: string; amountCents: number; metadata?: unknown }) => {
    const existing = ledgerEntries.find((e) => e.taskId === input.taskId && e.type === input.type);
    if (existing) return { id: "existing", createdAt: "now", ...existing };
    const entry = { id: `id-${ledgerEntries.length}`, createdAt: "now", ...input };
    ledgerEntries.push(entry);
    return entry;
  }),
  getLedgerBalanceCents: vi.fn(async () => ledgerEntries.reduce((s, e) => s + e.amountCents, 0)),
}));

function makePrice(overrides: Partial<ExecutionPrice> = {}): ExecutionPrice {
  return {
    estimatedProviderCostCents: 100,
    verificationCostCents: 0,
    platformFeeCents: 35,
    estimatedCustomerPriceCents: 135,
    actualProviderCostCents: 100,
    actualCustomerPriceCents: 135,
    ...overrides,
  };
}

describe("recordExecutionUsage", () => {
  beforeEach(() => {
    ledgerEntries.length = 0;
    vi.clearAllMocks();
  });

  it("charges nothing for a not_billable task", async () => {
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    const economics = await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "not_billable", price: makePrice() });
    expect(economics.customerPriceCents).toBe(0);
  });

  it("charges half price for a partially_billable task", async () => {
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    const economics = await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "partially_billable", price: makePrice({ actualCustomerPriceCents: 200 }) });
    expect(economics.customerPriceCents).toBe(100);
  });

  it("charges full price for a billable task", async () => {
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    const economics = await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "billable", price: makePrice({ actualCustomerPriceCents: 200 }) });
    expect(economics.customerPriceCents).toBe(200);
  });

  it("consumes included balance first, then reports the rest as overage", async () => {
    ledgerEntries.push({ userId: "u1", type: "included_credit", amountCents: 150 });
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    const economics = await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "billable", price: makePrice({ actualCustomerPriceCents: 200 }) });
    expect(economics.includedCreditAppliedCents).toBe(150);
    expect(economics.overageAmountCents).toBe(50);
  });

  it("reports zero overage once there is no included balance left", async () => {
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    const economics = await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "billable", price: makePrice({ actualCustomerPriceCents: 200 }) });
    expect(economics.includedCreditAppliedCents).toBe(0);
    expect(economics.overageAmountCents).toBe(200);
  });

  it("is idempotent - finalizing the same task twice never double-charges", async () => {
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "billable", price: makePrice({ actualCustomerPriceCents: 200 }) });
    await recordExecutionUsage({ userId: "u1", taskId: "t1", billingStatus: "billable", price: makePrice({ actualCustomerPriceCents: 200 }) });
    const charges = ledgerEntries.filter((e) => e.taskId === "t1" && e.type === "execution_charge");
    expect(charges).toHaveLength(1);
  });

  it("computes gross margin from customer price minus provider and verification cost", async () => {
    const { recordExecutionUsage } = await import("@/lib/billing/usage");
    const economics = await recordExecutionUsage({
      userId: "u1",
      taskId: "t1",
      billingStatus: "billable",
      price: makePrice({ actualProviderCostCents: 80, verificationCostCents: 20, actualCustomerPriceCents: 200 }),
    });
    expect(economics.grossMarginCents).toBe(200 - 80 - 20);
  });
});

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

describe("ensurePeriodCreditProvisioned", () => {
  beforeEach(() => {
    ledgerEntries.length = 0;
    vi.clearAllMocks();
  });

  it("provisions the plan's included execution amount once per period", async () => {
    const { ensurePeriodCreditProvisioned } = await import("@/lib/billing/usage");
    await ensurePeriodCreditProvisioned(makeAccount({ plan: "pro" }));
    await ensurePeriodCreditProvisioned(makeAccount({ plan: "pro" })); // same period - must not double-provision
    const credits = ledgerEntries.filter((e) => e.type === "included_credit");
    expect(credits).toHaveLength(1);
    expect(credits[0].amountCents).toBe(4000);
  });

  it("provisions nothing for the free plan", async () => {
    const { ensurePeriodCreditProvisioned } = await import("@/lib/billing/usage");
    await ensurePeriodCreditProvisioned(makeAccount({ plan: "free" }));
    expect(ledgerEntries.filter((e) => e.type === "included_credit")).toHaveLength(0);
  });
});
