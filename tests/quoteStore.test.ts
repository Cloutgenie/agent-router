import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionOffer, ExecutionQuote } from "@/types";
import { createFakeSupabase } from "./helpers/fakeSupabase";

const fakeSupabase = createFakeSupabase();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => fakeSupabase,
  isSupabaseConfigured: () => true,
}));

function makeOffer(overrides: Partial<ExecutionOffer> = {}): ExecutionOffer {
  return {
    executorId: "p1",
    capability: "company-research",
    estimatedCost: 1,
    estimatedLatencyMs: 2000,
    estimatedQuality: 0.8,
    estimatedVerificationRate: 0.7,
    reliability: 0.6,
    confidence: 0.5,
    available: true,
    ...overrides,
  };
}

describe("quoteStore", () => {
  beforeEach(() => {
    fakeSupabase.tables.clear();
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists one quote per offer, stamped with the task/step it belongs to", async () => {
    const { recordQuotes, getQuotesForTask } = await import("@/lib/market/quoteStore");

    await recordQuotes("task-1", "step-1", [makeOffer({ executorId: "a" }), makeOffer({ executorId: "b" })]);

    const quotes = await getQuotesForTask("task-1");
    expect(quotes).toHaveLength(2);
    expect(quotes.map((q) => q.executorId).sort()).toEqual(["a", "b"]);
    expect(quotes.every((q) => q.taskId === "task-1" && q.stepId === "step-1")).toBe(true);
  });

  it("does not write anything when there are no offers", async () => {
    const { recordQuotes } = await import("@/lib/market/quoteStore");

    await recordQuotes("task-1", "step-1", []);

    expect(fakeSupabase.tables.get("execution_quotes") ?? []).toHaveLength(0);
  });

  it("only returns quotes for the requested task", async () => {
    const { recordQuotes, getQuotesForTask } = await import("@/lib/market/quoteStore");

    await recordQuotes("task-1", "step-1", [makeOffer()]);
    await recordQuotes("task-2", "step-1", [makeOffer()]);

    const quotesForTask1 = await getQuotesForTask("task-1");
    expect(quotesForTask1).toHaveLength(1);
    expect(quotesForTask1[0].taskId).toBe("task-1");
  });

  it("accumulates quotes across multiple calls rather than overwriting", async () => {
    const { recordQuotes, getQuotesForTask } = await import("@/lib/market/quoteStore");

    await recordQuotes("task-1", "step-1", [makeOffer({ executorId: "a" })]);
    await recordQuotes("task-1", "step-2", [makeOffer({ executorId: "b" })]);

    const quotes: ExecutionQuote[] = await getQuotesForTask("task-1");
    expect(quotes).toHaveLength(2);
  });
});
