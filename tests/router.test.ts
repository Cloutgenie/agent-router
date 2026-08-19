import { afterEach, describe, expect, it, vi } from "vitest";
import { routeStep } from "@/lib/router/providerRouter";
import { makeMetrics, makeProvider } from "./fixtures";

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
      capability: "company-research",
      overrides: {},
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
      capability: "company-research",
      overrides: {},
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
      capability: "company-research",
      overrides: {},
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
      capability: "company-research",
      overrides: {},
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
      capability: "company-research",
      overrides: {},
      constraints: { routing_preference: "balanced" },
      performance: new Map(),
      explorationRate: 0,
    });
    const lowestCost = routeStep({
      providers: [cheapButWeak, pricyButStrong],
      capability: "company-research",
      overrides: {},
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
    const result = routeStep({
      providers: [],
      capability: "company-research",
      overrides: {},
      constraints: {},
      performance: new Map(),
      explorationRate: 0,
    });
    expect(result.candidates).toEqual([]);
    expect(result.selectedProviderId).toBeUndefined();
  });

  it("returns one ExecutionOffer per candidate, in the same order as candidates", () => {
    const a = makeProvider({ id: "a" });
    const b = makeProvider({ id: "b" });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [a, b],
      capability: "company-research",
      overrides: {},
      constraints: {},
      performance: new Map(),
      explorationRate: 0,
    });

    expect(result.offers).toHaveLength(2);
    expect(result.offers.map((o) => o.executorId)).toEqual(result.candidates.map((c) => c.provider_id));
  });

  it("surfaces trust_tier on every candidate but never uses it to exclude a candidate from a non-read-only step", () => {
    const brandNew = makeProvider({ id: "brand-new", capabilities: ["email-send"] });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [brandNew],
      capability: "email-send", // EXTERNAL_COMMUNICATION risk class, not READ_ONLY
      overrides: {},
      constraints: {},
      performance: new Map(),
      explorationRate: 0,
    });

    expect(result.candidates).toHaveLength(1); // not excluded, even though it's a zero-history "new" provider
    expect(result.candidates[0].trust_tier).toBe("new");
  });

  it("market-optimal mode picks the executor with real verified-outcome history over one with only a good raw quality score", () => {
    const flashyButUnverified = makeProvider({ id: "flashy", quality_score: 0.99, price_per_task: 1, average_latency_seconds: 2 });
    const provenTrackRecord = makeProvider({ id: "proven", quality_score: 0.7, price_per_task: 1, average_latency_seconds: 2 });

    const performance = new Map([
      [
        "proven",
        makeMetrics("proven", "company-research", {
          tasks_attempted: 200,
          success_count: 190,
          average_confidence: 0.85,
          verification_total: 200,
          verification_pass_count: 185,
        }),
      ],
    ]);

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [flashyButUnverified, provenTrackRecord],
      capability: "company-research",
      overrides: {},
      constraints: { routing_preference: "market-optimal" },
      performance,
      explorationRate: 0,
    });

    expect(result.selectedProviderId).toBe("proven");
  });

  it("highest-reliability mode reuses the standard formula, just weighted toward reliability_score", () => {
    const reliable = makeProvider({ id: "reliable", reliability_score: 0.99, quality_score: 0.5, price_per_task: 5 });
    const cheap = makeProvider({ id: "cheap", reliability_score: 0.4, quality_score: 0.99, price_per_task: 0.2 });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [reliable, cheap],
      capability: "company-research",
      overrides: {},
      constraints: { routing_preference: "highest-reliability" },
      performance: new Map(),
      explorationRate: 0,
    });

    expect(result.selectedProviderId).toBe("reliable");
  });

  it("excludes a candidate whose price exceeds maximum_cost entirely, rather than merely scoring it down", () => {
    const affordable = makeProvider({ id: "affordable", price_per_task: 1, quality_score: 0.5 });
    const pricy = makeProvider({ id: "pricy", price_per_task: 100, quality_score: 0.99 });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [affordable, pricy],
      capability: "company-research",
      overrides: {},
      constraints: { maximum_cost: 5 },
      performance: new Map(),
      explorationRate: 0,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].provider_id).toBe("affordable");
  });

  it("gives a provider with no verification history yet the benefit of the doubt against minimum_verification", () => {
    const provider = makeProvider({ id: "p1" });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [provider],
      capability: "company-research",
      overrides: {},
      constraints: { minimum_verification: 0.9 },
      performance: new Map(),
      explorationRate: 0,
    });

    expect(result.candidates).toHaveLength(1); // not excluded despite having 0 verified history
  });

  it("excludes a provider whose actual verification rate falls below minimum_verification once it has history", () => {
    const weak = makeProvider({ id: "weak" });
    const performance = new Map([
      ["weak", makeMetrics("weak", "company-research", { verification_total: 50, verification_pass_count: 5 })],
    ]);

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = routeStep({
      providers: [weak],
      capability: "company-research",
      overrides: {},
      constraints: { minimum_verification: 0.5 },
      performance,
      explorationRate: 0,
    });

    expect(result.candidates).toHaveLength(0);
  });
});
