import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        const err = new Error("not found") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
  },
}));

describe("executor payout accounts", () => {
  beforeEach(() => {
    files.clear();
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
    expect(files.size).toBe(0);
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
