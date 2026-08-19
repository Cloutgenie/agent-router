import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingAccount } from "@/types";

const createCustomer = vi.fn(async () => ({ id: "cus_new123" }));
const updateBillingAccountMock = vi.fn(async (patch: Partial<BillingAccount>) => ({ ...makeAccount(), ...patch }));

vi.mock("@/lib/billing/stripe/client", () => ({
  getStripeClient: () => ({ customers: { create: createCustomer } }),
}));

vi.mock("@/lib/billing/account", () => ({
  updateBillingAccount: (patch: Partial<BillingAccount>) => updateBillingAccountMock(patch),
}));

function makeAccount(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: "acct-1",
    userId: "u1",
    stripeCustomerId: null,
    subscriptionId: null,
    plan: "pro",
    status: "active",
    spendingLimits: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ensureStripeCustomer", () => {
  beforeEach(() => {
    createCustomer.mockClear();
    updateBillingAccountMock.mockClear();
  });

  it("reuses an existing stripeCustomerId without calling Stripe", async () => {
    const { ensureStripeCustomer } = await import("@/lib/billing/stripe/customer");
    const id = await ensureStripeCustomer(makeAccount({ stripeCustomerId: "cus_existing" }));
    expect(id).toBe("cus_existing");
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("creates a Stripe customer and persists it when there is none yet", async () => {
    const { ensureStripeCustomer } = await import("@/lib/billing/stripe/customer");
    const id = await ensureStripeCustomer(makeAccount({ stripeCustomerId: null }));
    expect(id).toBe("cus_new123");
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(updateBillingAccountMock).toHaveBeenCalledWith({ stripeCustomerId: "cus_new123" });
  });
});
