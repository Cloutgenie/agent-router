import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./helpers/fakeSupabase";

const fakeSupabase = createFakeSupabase();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => fakeSupabase,
  isSupabaseConfigured: () => true,
}));

describe("billing account", () => {
  const originalPlan = process.env.BILLING_DEFAULT_PLAN;

  beforeEach(() => {
    fakeSupabase.tables.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.BILLING_DEFAULT_PLAN = originalPlan;
  });

  it("creates a default account on first read, defaulting to pro", async () => {
    delete process.env.BILLING_DEFAULT_PLAN;
    const { getBillingAccount, DEFAULT_USER_ID } = await import("@/lib/billing/account");
    const account = await getBillingAccount();
    expect(account.userId).toBe(DEFAULT_USER_ID);
    expect(account.plan).toBe("pro");
    expect(account.status).toBe("active");
    expect(account.spendingLimits).toEqual({});
  });

  it("respects BILLING_DEFAULT_PLAN for a fresh account", async () => {
    process.env.BILLING_DEFAULT_PLAN = "business";
    const { getBillingAccount } = await import("@/lib/billing/account");
    expect((await getBillingAccount()).plan).toBe("business");
  });

  it("persists updates and returns them on the next read", async () => {
    const { getBillingAccount, updateBillingAccount } = await import("@/lib/billing/account");
    await getBillingAccount(); // create it first
    await updateBillingAccount({ plan: "starter", status: "past_due" });
    const reread = await getBillingAccount();
    expect(reread.plan).toBe("starter");
    expect(reread.status).toBe("past_due");
  });

  it("setSpendingLimits persists the limits", async () => {
    const { getBillingAccount, setSpendingLimits } = await import("@/lib/billing/account");
    await getBillingAccount();
    await setSpendingLimits({ maxPerTaskCents: 1000, maxPerDayCents: 5000 });
    const reread = await getBillingAccount();
    expect(reread.spendingLimits).toEqual({ maxPerTaskCents: 1000, maxPerDayCents: 5000 });
  });
});
