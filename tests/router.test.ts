import { afterEach, describe, expect, it, vi } from "vitest";
import { routeStep } from "@/lib/router/providerRouter";
import { makeProvider } from "./fixtures";

describe("routeStep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scores capability fit, quality, cost, and latency transparently", () => {
    const cheap = makeProvider({ id: "cheap", price_per_task: 0.5, average_latency_seconds: 2, quality_score: 0.7 });
    const premium = makeProvider({ id: "premium", price_per_task: 3, average_latency_seconds: 6, quality_score: 0.98 });

    vi.spyOn(Math, "random").mockReturnValue(0.99); // never exploration-trigger
    const result = routeStep({
      providers: [cheap, premium],
      constraints: {},
      performance: new Map(),
      explorationRate: 0,
    });

    expect(result.candidates).toHaveLength(2);
    const cheapScore = result.candidates.find((c) => c.provider_id === "cheap")!;
    expect(cheapScore.cost_efficiency).toBe(1); // cheapest in the pool
    expect(cheapScore.latency_score).toBe(1); // fastest in the pool
  });

  it("applies a 50% score penalty and flags candidates over budget", () => {
    const affordable = makeProvider({ id: "affordable", price_per_task: 1 });
    const expensive = makeProvider({ id: "expensive", price_per_task: 10 });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [affordable, expensive],
      constraints: { budget: 2 },
      performance: new Map(),
      explorationRate: 0,
      budgetRemaining: 2,
    });

    const expensiveScore = result.candidates.find((c) => c.provider_id === "expensive")!;
    const affordableScore = result.candidates.find((c) => c.provider_id === "affordable")!;
    expect(expensiveScore.within_budget).toBe(false);
    expect(affordableScore.within_budget).toBe(true);
    // The over-budget candidate should never outrank an in-budget one with a similar profile.
    expect(result.selectedProviderId).toBe("affordable");
  });

  it("selects the top-scoring provider when exploration does not trigger", () => {
    const best = makeProvider({ id: "best", quality_score: 0.99, reliability_score: 0.99, success_rate: 0.99 });
    const worst = makeProvider({ id: "worst", quality_score: 0.3, reliability_score: 0.3, success_rate: 0.3 });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [best, worst],
      constraints: {},
      performance: new Map(),
      explorationRate: 0.1,
    });

    expect(result.selectedProviderId).toBe("best");
    expect(result.candidates.find((c) => c.provider_id === "best")?.explored).toBe(false);
  });

  it("occasionally explores the runner-up provider instead of the top scorer", () => {
    const best = makeProvider({ id: "best", quality_score: 0.99, reliability_score: 0.99, success_rate: 0.99 });
    const runnerUp = makeProvider({ id: "runner-up", quality_score: 0.6, reliability_score: 0.6, success_rate: 0.6 });

    vi.spyOn(Math, "random").mockReturnValue(0.01); // well inside a 10% exploration rate
    const result = routeStep({
      providers: [best, runnerUp],
      constraints: {},
      performance: new Map(),
      explorationRate: 0.1,
    });

    expect(result.selectedProviderId).toBe("runner-up");
    expect(result.candidates.find((c) => c.provider_id === "runner-up")?.explored).toBe(true);
  });

  it("shifts weighting toward cost when routing_preference is lowest-cost", () => {
    const cheapButWeak = makeProvider({ id: "cheap-weak", price_per_task: 0.3, quality_score: 0.5 });
    const pricyButStrong = makeProvider({ id: "pricy-strong", price_per_task: 5, quality_score: 0.99 });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const balanced = routeStep({
      providers: [cheapButWeak, pricyButStrong],
      constraints: { routing_preference: "balanced" },
      performance: new Map(),
      explorationRate: 0,
    });
    const lowestCost = routeStep({
      providers: [cheapButWeak, pricyButStrong],
      constraints: { routing_preference: "lowest-cost" },
      performance: new Map(),
      explorationRate: 0,
    });

    const balancedGap =
      balanced.candidates.find((c) => c.provider_id === "pricy-strong")!.total_score -
      balanced.candidates.find((c) => c.provider_id === "cheap-weak")!.total_score;
    const lowestCostGap =
      lowestCost.candidates.find((c) => c.provider_id === "pricy-strong")!.total_score -
      lowestCost.candidates.find((c) => c.provider_id === "cheap-weak")!.total_score;

    // Favoring cost should narrow (or flip) the gap in favor of the cheap provider.
    expect(lowestCostGap).toBeLessThan(balancedGap);
  });

  it("returns no candidates when no providers are eligible", () => {
    const result = routeStep({ providers: [], constraints: {}, performance: new Map(), explorationRate: 0 });
    expect(result.candidates).toEqual([]);
    expect(result.selectedProviderId).toBeUndefined();
  });
});
