import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./helpers/fakeSupabase";

const fakeSupabase = createFakeSupabase();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => fakeSupabase,
  isSupabaseConfigured: () => true,
}));

describe("executor payout accounts", () => {
  beforeEach(() => {
    fakeSupabase.tables.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults an unknown executor to not_configured without persisting anything", async () => {
    const { getPayoutAccount } = await import("@/lib/billing/payoutAccounts");
    const account = await getPayoutAccount("tavily-provider");
    expect(account.payoutStatus).toBe("not_configured");
    expect(account.stripeConnectedAccountId).toBeUndefined();
    expect(fakeSupabase.tables.get("payout_accounts") ?? []).toHaveLength(0);
  });

  it("persists a status change and returns it on the next read", async () => {
    const { getPayoutAccount, setPayoutAccountStatus } = await import("@/lib/billing/payoutAccounts");
    await setPayoutAccountStatus("tavily-provider", "pending");
    const reread = await getPayoutAccount("tavily-provider");
    expect(reread.payoutStatus).toBe("pending");
  });

  it("stores an optional stripeConnectedAccountId and preserves it across later status-only updates", async () => {
    const { getPayoutAccount, setPayoutAccountStatus } = await import("@/lib/billing/payoutAccounts");
    await setPayoutAccountStatus("apollo-provider", "active", "acct_123");
    let account = await getPayoutAccount("apollo-provider");
    expect(account.stripeConnectedAccountId).toBe("acct_123");

    await setPayoutAccountStatus("apollo-provider", "restricted");
    account = await getPayoutAccount("apollo-provider");
    expect(account.payoutStatus).toBe("restricted");
    expect(account.stripeConnectedAccountId).toBe("acct_123");
  });

  it("keeps separate executors independent", async () => {
    const { getAllPayoutAccounts, setPayoutAccountStatus } = await import("@/lib/billing/payoutAccounts");
    await setPayoutAccountStatus("a", "active");
    await setPayoutAccountStatus("b", "pending");
    const all = await getAllPayoutAccounts();
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);
    expect(all.a.payoutStatus).toBe("active");
    expect(all.b.payoutStatus).toBe("pending");
  });
});
