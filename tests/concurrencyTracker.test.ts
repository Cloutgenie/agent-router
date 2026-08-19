import { describe, expect, it } from "vitest";
import { activeRunCount, beginRun, endRun, isAtConcurrencyLimit } from "@/lib/providers/concurrencyTracker";

describe("concurrencyTracker", () => {
  it("has no limit when maxConcurrentRuns is unset", () => {
    expect(isAtConcurrencyLimit("provider-a", undefined)).toBe(false);
  });

  it("tracks active runs and reports the limit once reached", () => {
    const id = "provider-b";
    expect(activeRunCount(id)).toBe(0);

    beginRun(id);
    beginRun(id);
    expect(activeRunCount(id)).toBe(2);
    expect(isAtConcurrencyLimit(id, 2)).toBe(true);
    expect(isAtConcurrencyLimit(id, 3)).toBe(false);

    endRun(id);
    expect(activeRunCount(id)).toBe(1);
    expect(isAtConcurrencyLimit(id, 2)).toBe(false);

    endRun(id);
    expect(activeRunCount(id)).toBe(0);
  });

  it("never goes negative when endRun is called more than beginRun", () => {
    const id = "provider-c";
    endRun(id);
    endRun(id);
    expect(activeRunCount(id)).toBe(0);
  });
});
