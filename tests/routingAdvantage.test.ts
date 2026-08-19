import { describe, expect, it } from "vitest";
import { computeRoutingAdvantage } from "@/lib/history/routingAdvantage";
import { RoutingExperiment, StrategyComparison } from "@/types";

function makeComparison(overrides: Partial<StrategyComparison> = {}): StrategyComparison {
  return {
    single: { strategy: "single", providerNames: [], quality: 50, evidenceCoverage: 0.4, verifiedClaimRate: 0.4, totalCost: 1, totalLatency: 5, resultCount: 3, failedCount: 1 },
    routed: { strategy: "routed", providerNames: [], quality: 80, evidenceCoverage: 0.8, verifiedClaimRate: 0.8, totalCost: 2, totalLatency: 8, resultCount: 5, failedCount: 0 },
    winner: "routed",
    qualityDelta: 30,
    evidenceCoverageDelta: 0.4,
    verifiedClaimRateDelta: 0.4,
    failedRateDelta: -0.2,
    ...overrides,
  };
}

function makeExperiment(comparison: Partial<StrategyComparison> = {}): RoutingExperiment {
  return { id: "exp-1", taskId: "task-1", raw_task: "test", createdAt: new Date().toISOString(), comparison: makeComparison(comparison) };
}

describe("computeRoutingAdvantage", () => {
  it("returns null when there are no experiments", () => {
    expect(computeRoutingAdvantage([])).toBeNull();
  });

  it("averages deltas across experiments and reports sample size", () => {
    const result = computeRoutingAdvantage([
      makeExperiment({ qualityDelta: 10 }),
      makeExperiment({ qualityDelta: 30 }),
    ]);
    expect(result?.quality).toBe(20);
    expect(result?.sampleSize).toBe(2);
  });

  it("rounds to 1 decimal", () => {
    const result = computeRoutingAdvantage([
      makeExperiment({ qualityDelta: 1 }),
      makeExperiment({ qualityDelta: 2 }),
      makeExperiment({ qualityDelta: 2 }),
    ]);
    expect(result?.quality).toBe(1.7); // 5/3 = 1.666... rounded to 1.7
  });
});
