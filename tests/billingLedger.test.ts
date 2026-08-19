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

describe("billing ledger", () => {
  beforeEach(() => {
    files.clear();
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
});
