import { describe, expect, it } from "vitest";
import {
  computeCapabilityDemand,
  computeExecutionAlpha,
  computeExecutorSupply,
  computeMarketGaps,
  computeMarketOverview,
} from "@/lib/market/marketAnalytics";
import { ExecutionQuote } from "@/types";
import { makeCompletedStep, makeMetrics, makeProvider, makeStep, makeTask, makeUnmetStep } from "./fixtures";

describe("computeCapabilityDemand", () => {
  it("counts steps, tasks, and success rate per capability", () => {
    const tasks = [
      makeTask({ id: "t1", plan: { goal: "g", steps: [makeCompletedStep("s1", "research-agent", { capability: "company-research" })] } }),
      makeTask({ id: "t2", plan: { goal: "g", steps: [makeCompletedStep("s1", "tavily", { capability: "company-research" })] } }),
    ];

    const demand = computeCapabilityDemand(tasks);
    const companyResearch = demand.find((d) => d.capability === "company-research")!;
    expect(companyResearch.taskCount).toBe(2);
    expect(companyResearch.stepCount).toBe(2);
    expect(companyResearch.completedCount).toBe(2);
    expect(companyResearch.successRate).toBe(1);
    expect(companyResearch.activeExecutorCount).toBe(2); // research-agent and tavily, distinct
  });

  it("counts a step that failed with zero candidates as unmet demand, not just a failure", () => {
    const tasks = [
      makeTask({ plan: { goal: "g", steps: [makeUnmetStep("s1", "official-source-verification")] } }),
    ];
    const demand = computeCapabilityDemand(tasks);
    const verification = demand.find((d) => d.capability === "official-source-verification")!;
    expect(verification.unmetCount).toBe(1);
    expect(verification.successRate).toBe(0);
  });

  it("does not count an execution failure (candidates existed, all just failed) as unmet demand", () => {
    const tasks = [
      makeTask({
        plan: {
          goal: "g",
          steps: [
            makeStep({
              id: "s1",
              capability: "hiring-signals",
              status: "failed",
              candidates: [
                {
                  provider_id: "p1", provider_name: "p1", capability_fit: 1, quality_score: 0.5, reliability_score: 0.5,
                  success_rate: 0.5, cost_efficiency: 0.5, latency_score: 0.5, historical_bonus: 0, total_score: 0.5,
                  within_budget: true, configured: true, selected: true, explored: false, trust_tier: "trusted",
                },
              ],
            }),
          ],
        },
      }),
    ];
    const demand = computeCapabilityDemand(tasks);
    expect(demand.find((d) => d.capability === "hiring-signals")!.unmetCount).toBe(0);
  });
});

describe("computeExecutorSupply", () => {
  it("tracks eligibility, wins, and win rate per provider", () => {
    const providers = [makeProvider({ id: "a", name: "A" }), makeProvider({ id: "b", name: "B" })];
    const stepWithBothEligible = makeCompletedStep("s1", "a");
    stepWithBothEligible.candidates.push({
      provider_id: "b", provider_name: "B", capability_fit: 1, quality_score: 0.5, reliability_score: 0.5,
      success_rate: 0.5, cost_efficiency: 0.5, latency_score: 0.5, historical_bonus: 0, total_score: 0.4,
      within_budget: true, configured: true, selected: false, explored: false, trust_tier: "trusted",
    });
    const tasks = [makeTask({ plan: { goal: "g", steps: [stepWithBothEligible] } })];

    const supply = computeExecutorSupply(tasks, providers, {});
    const a = supply.find((s) => s.executorId === "a")!;
    const b = supply.find((s) => s.executorId === "b")!;
    expect(a.timesEligible).toBe(1);
    expect(a.jobsCompleted).toBe(1);
    expect(a.winRate).toBe(1);
    expect(b.timesEligible).toBe(1);
    expect(b.jobsCompleted).toBe(0);
    expect(b.winRate).toBe(0);
  });

  it("includes every registered provider even with zero history", () => {
    const providers = [makeProvider({ id: "brand-new" })];
    const supply = computeExecutorSupply([], providers, {});
    expect(supply).toHaveLength(1);
    expect(supply[0].trustTier).toBe("new");
  });

  it("reports suspended/degraded straight from the override state", () => {
    const providers = [makeProvider({ id: "a" })];
    const supply = computeExecutorSupply([], providers, {
      a: { enabled: false, degraded: false, updatedAt: new Date().toISOString(), updatedBy: "auto" },
    });
    expect(supply[0].trustTier).toBe("suspended");
  });
});

describe("computeMarketGaps", () => {
  it("flags a capability with only one active executor as a high-severity gap", () => {
    const gaps = computeMarketGaps([
      { capability: "company-research", taskCount: 5, stepCount: 5, completedCount: 5, unmetCount: 0, successRate: 1, avgCost: 1, avgLatencySeconds: 2, activeExecutorCount: 1 },
    ]);
    expect(gaps[0].severity).toBe("high");
  });

  it("flags a high failure rate as a gap even with plenty of executors", () => {
    const gaps = computeMarketGaps([
      { capability: "company-research", taskCount: 10, stepCount: 10, completedCount: 4, unmetCount: 0, successRate: 0.4, avgCost: 1, avgLatencySeconds: 2, activeExecutorCount: 5 },
    ]);
    expect(gaps[0].severity).toBe("high");
  });

  it("does not flag healthy supply as a gap", () => {
    const gaps = computeMarketGaps([
      { capability: "company-research", taskCount: 20, stepCount: 20, completedCount: 19, unmetCount: 0, successRate: 0.95, avgCost: 1, avgLatencySeconds: 2, activeExecutorCount: 5 },
    ]);
    expect(gaps[0].severity).toBe("low");
  });

  it("skips capabilities with no demand at all", () => {
    const gaps = computeMarketGaps([
      { capability: "company-research", taskCount: 0, stepCount: 0, completedCount: 0, unmetCount: 0, successRate: 0, avgCost: 0, avgLatencySeconds: 0, activeExecutorCount: 0 },
    ]);
    expect(gaps).toHaveLength(0);
  });
});

describe("computeExecutionAlpha", () => {
  function quote(taskId: string, stepId: string, executorId: string, overrides: Partial<ExecutionQuote> = {}): ExecutionQuote {
    return {
      id: `q-${taskId}-${stepId}-${executorId}`,
      taskId,
      stepId,
      executorId,
      capability: "company-research",
      priceEstimate: 1,
      latencyEstimateMs: 1000,
      qualityEstimate: 0.5,
      reliabilityEstimate: 0.5,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("skips a step with fewer than 2 quotes - no real competition to compare against", () => {
    const tasks = [makeTask({ id: "t1", plan: { goal: "g", steps: [makeCompletedStep("s1", "a")] } })];
    const quotes = [quote("t1", "s1", "a")];
    expect(computeExecutionAlpha(tasks, quotes).sampleSize).toBe(0);
  });

  it("computes a positive lift when the selected executor beats the field", () => {
    const tasks = [makeTask({ id: "t1", plan: { goal: "g", steps: [makeCompletedStep("s1", "winner")] } })];
    const quotes = [
      quote("t1", "s1", "winner", { qualityEstimate: 0.9, priceEstimate: 0.5, latencyEstimateMs: 500, reliabilityEstimate: 0.9 }),
      quote("t1", "s1", "loser", { qualityEstimate: 0.4, priceEstimate: 2, latencyEstimateMs: 3000, reliabilityEstimate: 0.4 }),
    ];
    const alpha = computeExecutionAlpha(tasks, quotes);
    expect(alpha.sampleSize).toBe(1);
    expect(alpha.qualityLift).toBeGreaterThan(0);
    expect(alpha.costReduction).toBeGreaterThan(0); // median (1.25) - selected price (0.5) > 0
    expect(alpha.latencyReductionMs).toBeGreaterThan(0);
    expect(alpha.reliabilityLift).toBeGreaterThan(0);
  });
});

describe("computeMarketOverview", () => {
  it("aggregates verified outcome rate weighted by verification volume", () => {
    const overview = computeMarketOverview(
      [],
      [],
      [makeProvider({ id: "a", configured: true }), makeProvider({ id: "b", configured: false })],
      [
        makeMetrics("a", "company-research", { verification_total: 100, verification_pass_count: 90 }),
        makeMetrics("b", "company-research", { verification_total: 10, verification_pass_count: 1 }),
      ]
    );
    // weighted: (90+1)/(100+10) = 91/110 ~ 0.83, not a naive average of 0.9 and 0.1
    expect(overview.verifiedOutcomeRate).toBeCloseTo(0.83, 1);
    expect(overview.activeExecutorCount).toBe(1);
  });

  it("counts unmet demand and execution volume from the demand breakdown", () => {
    const overview = computeMarketOverview(
      [],
      [
        { capability: "company-research", taskCount: 1, stepCount: 3, completedCount: 2, unmetCount: 1, successRate: 0.67, avgCost: 1, avgLatencySeconds: 1, activeExecutorCount: 1 },
      ],
      [],
      []
    );
    expect(overview.unmetDemandCount).toBe(1);
    expect(overview.executionVolume).toBe(2);
  });
});
