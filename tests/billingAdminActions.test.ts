import { beforeEach, describe, expect, it, vi } from "vitest";

const appendManualLedgerEntry = vi.fn(async (input: unknown) => ({ id: "ledger-1", createdAt: "now", ...(input as object) }));

vi.mock("@/lib/billing/ledger", () => ({
  appendManualLedgerEntry: (input: unknown) => appendManualLedgerEntry(input),
}));

describe("grantCredit / removeCredit", () => {
  beforeEach(() => {
    appendManualLedgerEntry.mockClear();
  });

  it("requires a non-empty reason to grant credit", async () => {
    const { grantCredit } = await import("@/lib/billing/adminActions");
    await expect(grantCredit("u1", 1000, "")).rejects.toThrow(/reason/i);
    await expect(grantCredit("u1", 1000, "   ")).rejects.toThrow(/reason/i);
    expect(appendManualLedgerEntry).not.toHaveBeenCalled();
  });

  it("requires a non-empty reason to remove credit", async () => {
    const { removeCredit } = await import("@/lib/billing/adminActions");
    await expect(removeCredit("u1", 1000, "")).rejects.toThrow(/reason/i);
  });

  it("rejects a non-positive amount", async () => {
    const { grantCredit } = await import("@/lib/billing/adminActions");
    await expect(grantCredit("u1", 0, "goodwill credit")).rejects.toThrow(/positive/i);
    await expect(grantCredit("u1", -100, "goodwill credit")).rejects.toThrow(/positive/i);
  });

  it("grants credit as a positive ledger amount, tagged with the reason", async () => {
    const { grantCredit } = await import("@/lib/billing/adminActions");
    await grantCredit("u1", 500, "customer service goodwill credit");
    expect(appendManualLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        type: "credit_adjustment",
        amountCents: 500,
        metadata: { reason: "customer service goodwill credit", direction: "grant" },
      })
    );
  });

  it("removes credit as a negative ledger amount", async () => {
    const { removeCredit } = await import("@/lib/billing/adminActions");
    await removeCredit("u1", 500, "correcting a duplicate grant");
    expect(appendManualLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ amountCents: -500 }));
  });
});
