import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionOffer, ExecutionQuote } from "@/types";

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
    files.clear();
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
    const fs = (await import("node:fs/promises")).default;
    const { recordQuotes } = await import("@/lib/market/quoteStore");

    await recordQuotes("task-1", "step-1", []);

    expect(fs.writeFile).not.toHaveBeenCalled();
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
