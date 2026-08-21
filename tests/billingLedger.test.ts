import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./helpers/fakeSupabase";

const fakeSupabase = createFakeSupabase();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => fakeSupabase,
  isSupabaseConfigured: () => true,
}));

describe("billing ledger", () => {
  beforeEach(() => {
    fakeSupabase.tables.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sums entries to compute the balance directly from the ledger, not a cached counter", async () => {
    const { appendLedgerEntry, getLedgerBalanceCents } = await import("@/lib/billing/ledger");
    await appendLedgerEntry({ userId: "u1", type: "included_credit", amountCents: 4000 });
    await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "execution_charge", amountCents: -1200 });
    expect(await getLedgerBalanceCents("u1")).toBe(2800);
  });

  it("is idempotent by taskId+type - a duplicate call never writes a second entry", async () => {
    const { appendLedgerEntry, getLedgerForUser } = await import("@/lib/billing/ledger");
    const first = await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "execution_charge", amountCents: -500 });
    const second = await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "execution_charge", amountCents: -500 });
    expect(second.id).toBe(first.id);
    const entries = await getLedgerForUser("u1");
    expect(entries.filter((e) => e.taskId === "t1" && e.type === "execution_charge")).toHaveLength(1);
  });

  it("allows distinct entry types for the same task (e.g. a credit and a charge both keyed to it)", async () => {
    const { appendLedgerEntry, getLedgerForUser } = await import("@/lib/billing/ledger");
    await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "execution_charge", amountCents: -500 });
    await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "refund", amountCents: 500 });
    const entries = await getLedgerForUser("u1");
    expect(entries).toHaveLength(2);
  });

  it("scopes charge-window sums to the given date range and user", async () => {
    const { appendLedgerEntry, getChargesInWindow } = await import("@/lib/billing/ledger");
    await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "execution_charge", amountCents: -300 });
    await appendLedgerEntry({ userId: "u2", taskId: "t2", type: "execution_charge", amountCents: -900 });
    const total = await getChargesInWindow("u1", "2000-01-01T00:00:00.000Z", "2999-01-01T00:00:00.000Z");
    expect(total).toBe(300);
  });

  it("appendManualLedgerEntry always writes a fresh entry, never deduping like appendLedgerEntry does", async () => {
    const { appendManualLedgerEntry, getLedgerForUser } = await import("@/lib/billing/ledger");
    await appendManualLedgerEntry({ userId: "u1", type: "credit_adjustment", amountCents: 500 });
    await appendManualLedgerEntry({ userId: "u1", type: "credit_adjustment", amountCents: 500 });
    const entries = await getLedgerForUser("u1");
    expect(entries).toHaveLength(2); // two distinct admin actions, not deduped
  });

  it("getAdjustmentsInWindow sums signed credit_adjustment entries, distinct from charges", async () => {
    const { appendManualLedgerEntry, appendLedgerEntry, getAdjustmentsInWindow } = await import("@/lib/billing/ledger");
    await appendManualLedgerEntry({ userId: "u1", type: "credit_adjustment", amountCents: 1000 }); // grant
    await appendManualLedgerEntry({ userId: "u1", type: "credit_adjustment", amountCents: -300 }); // removal
    await appendLedgerEntry({ userId: "u1", taskId: "t1", type: "execution_charge", amountCents: -500 }); // not an adjustment
    const total = await getAdjustmentsInWindow("u1", "2000-01-01T00:00:00.000Z", "2999-01-01T00:00:00.000Z");
    expect(total).toBe(700);
  });
});
