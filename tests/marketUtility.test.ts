import { describe, expect, it } from "vitest";
import {
  buildExecutionOffer,
  computeCapabilityPerformance,
  computeUtility,
  wilsonLowerBound,
} from "@/lib/router/marketUtility";
import { makeMetrics, makeProvider } from "./fixtures";

describe("wilsonLowerBound", () => {
  it("returns a neutral 0.5 prior when there is no data", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0.5);
  });

  it("does not let a tiny perfect sample outrank a large, consistently strong one", () => {
    const tinyPerfect = wilsonLowerBound(2, 2); // 2/2
    const largeStrong = wilsonLowerBound(950, 1000); // 95/100 at scale
    expect(largeStrong).toBeGreaterThan(tinyPerfect);
  });

  it("moves toward the raw rate as sample size grows", () => {
    const small = wilsonLowerBound(8, 10);
    const large = wilsonLowerBound(800, 1000);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(0.85); // still below the raw 0.8 rate, but much closer than the small sample
  });
});

describe("computeCapabilityPerformance", () => {
  it("falls back fully to the provider's static priors when there is no history (cold start)", () => {
    const provider = makeProvider({ id: "p1", quality_score: 0.77, price_per_task: 2, average_latency_seconds: 4 });
    const perf = computeCapabilityPerformance(provider, "company-research", undefined);

    expect(perf.jobsCompleted).toBe(0);
    expect(perf.avgQuality).toBe(0.77); // shrinkage weight 0 at n=0 - pure prior
    expect(perf.avgLatencyMs).toBe(4000);
    expect(perf.successRate).toBe(0.5); // neutral Wilson prior, not 0
    expect(perf.fallbackRate).toBe(0);
  });

  it("blends toward observed data as sample size grows", () => {
    const provider = makeProvider({ id: "p1", quality_score: 0.5 });
    const metrics = makeMetrics("p1", "company-research", {
      tasks_attempted: 200,
      success_count: 190,
      average_confidence: 0.95,
    });
    const perf = computeCapabilityPerformance(provider, "company-research", metrics);

    expect(perf.jobsCompleted).toBe(200);
    expect(perf.successRate).toBeGreaterThan(0.85); // Wilson bound on 190/200, well above the static prior
    expect(perf.avgQuality).toBeGreaterThan(0.9); // mostly trusts the observed 0.95 over the 0.5 prior at n=200
  });
});

describe("buildExecutionOffer", () => {
  it("reports low confidence for a brand-new executor and scales up with sample size", () => {
    const provider = makeProvider({ id: "p1" });
    const cold = buildExecutionOffer(provider, computeCapabilityPerformance(provider, "company-research", undefined));
    const warm = buildExecutionOffer(
      provider,
      computeCapabilityPerformance(provider, "company-research", makeMetrics("p1", "company-research", { tasks_attempted: 40 }))
    );

    expect(cold.confidence).toBe(0);
    expect(warm.confidence).toBe(1); // capped at 1 past 20 jobs
  });
});

describe("computeUtility", () => {
  it("rewards verification and reliability, not just raw quality", () => {
    const provider = makeProvider({ id: "p1" });
    const highQualityLowVerification = computeCapabilityPerformance(
      provider,
      "company-research",
      makeMetrics("p1", "company-research", {
        tasks_attempted: 100,
        success_count: 50,
        average_confidence: 0.99,
        verification_total: 100,
        verification_pass_count: 10,
      })
    );
    const balancedStrong = computeCapabilityPerformance(
      provider,
      "company-research",
      makeMetrics("p1", "company-research", {
        tasks_attempted: 100,
        success_count: 92,
        average_confidence: 0.85,
        verification_total: 100,
        verification_pass_count: 90,
      })
    );

    const utilityHighQuality = computeUtility(highQualityLowVerification, 0, 0);
    const utilityBalanced = computeUtility(balancedStrong, 0, 0);

    expect(utilityBalanced).toBeGreaterThan(utilityHighQuality);
  });

  it("penalizes normalized cost and latency", () => {
    const provider = makeProvider({ id: "p1" });
    const perf = computeCapabilityPerformance(provider, "company-research", undefined);
    const cheapFast = computeUtility(perf, 0, 0);
    const pricySlow = computeUtility(perf, 1, 1);
    expect(cheapFast).toBeGreaterThan(pricySlow);
  });
});
