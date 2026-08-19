import { describe, expect, it } from "vitest";
import {
  buildExecutionOffer,
  computeCapabilityPerformance,
  computeTrustTier,
  computeUtility,
  wilsonLowerBound,
} from "@/lib/router/marketUtility";
import { ProviderOverride, TimestampedOutcome } from "@/types";
import { makeMetrics, makeProvider } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

function outcomesAgo(daysAgo: number, count: number, passed: boolean, now: number): TimestampedOutcome[] {
  return Array.from({ length: count }, () => ({ timestamp: new Date(now - daysAgo * DAY_MS).toISOString(), passed }));
}

function overrideOf(patch: Partial<ProviderOverride>): ProviderOverride {
  return { enabled: true, degraded: false, updatedAt: new Date().toISOString(), updatedBy: "manual", ...patch };
}

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

  it("falls back to the pure lifetime rate when there is no recency log yet, rather than dragging it toward neutral", () => {
    const provider = makeProvider({ id: "p1" });
    const metrics = makeMetrics("p1", "company-research", {
      tasks_attempted: 200,
      success_count: 190,
      // recent_attempts intentionally left as [] - simulates lifetime totals that predate the recency log field
    });
    const perf = computeCapabilityPerformance(provider, "company-research", metrics);
    expect(perf.successRate).toBeGreaterThan(0.85); // must not be dragged toward 0.5 by an empty recency log
  });

  it("weighs a recent failure streak more heavily than an old one at the same lifetime rate", () => {
    const provider = makeProvider({ id: "p1" });
    const now = Date.parse("2026-06-01T00:00:00.000Z");

    const recentlyDeclined = computeCapabilityPerformance(
      provider,
      "company-research",
      makeMetrics("p1", "company-research", {
        tasks_attempted: 100,
        success_count: 50,
        recent_attempts: [...outcomesAgo(5, 10, false, now), ...outcomesAgo(5, 2, true, now)], // mostly failing lately
      }),
      now
    );
    const recoveredRecently = computeCapabilityPerformance(
      provider,
      "company-research",
      makeMetrics("p1", "company-research", {
        tasks_attempted: 100,
        success_count: 50, // identical lifetime rate to the case above
        recent_attempts: [...outcomesAgo(5, 10, true, now), ...outcomesAgo(5, 2, false, now)], // mostly succeeding lately
      }),
      now
    );

    expect(recoveredRecently.successRate).toBeGreaterThan(recentlyDeclined.successRate);
  });

  it("gives an old batch of outcomes much less weight than the same batch happening recently", () => {
    const provider = makeProvider({ id: "p1" });
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    const mixedBatch = (daysAgo: number) => [...outcomesAgo(daysAgo, 15, true, now), ...outcomesAgo(daysAgo, 5, false, now)]; // 75% rate

    const old = computeCapabilityPerformance(
      provider,
      "company-research",
      makeMetrics("p1", "company-research", { tasks_attempted: 100, success_count: 90, recent_attempts: mixedBatch(220) }), // lowest weight tier
      now
    );
    const recent = computeCapabilityPerformance(
      provider,
      "company-research",
      makeMetrics("p1", "company-research", { tasks_attempted: 100, success_count: 90, recent_attempts: mixedBatch(2) }), // full weight
      now
    );

    // Same lifetime totals, same recent batch composition - only age differs.
    // The old batch's tiny effective sample size pulls its Wilson bound
    // toward the neutral 0.5 prior; the recent one gets to keep more of its
    // own signal.
    expect(recent.successRate).toBeGreaterThan(old.successRate);
  });
});

describe("computeTrustTier", () => {
  it("classifies a provider with zero jobs as new", () => {
    const perf = computeCapabilityPerformance(makeProvider({ id: "p1" }), "company-research", undefined);
    expect(computeTrustTier(perf, undefined)).toBe("new");
  });

  it("classifies a provider with a handful of jobs as probation", () => {
    const perf = computeCapabilityPerformance(
      makeProvider({ id: "p1" }),
      "company-research",
      makeMetrics("p1", "company-research", { tasks_attempted: 3, success_count: 3 })
    );
    expect(computeTrustTier(perf, undefined)).toBe("probation");
  });

  it("classifies a provider with an established job count as trusted", () => {
    const perf = computeCapabilityPerformance(
      makeProvider({ id: "p1" }),
      "company-research",
      makeMetrics("p1", "company-research", { tasks_attempted: 50, success_count: 45 })
    );
    expect(computeTrustTier(perf, undefined)).toBe("trusted");
  });

  it("reports degraded/suspended straight from the existing kill-switch override, regardless of job count", () => {
    const perf = computeCapabilityPerformance(
      makeProvider({ id: "p1" }),
      "company-research",
      makeMetrics("p1", "company-research", { tasks_attempted: 500, success_count: 490 })
    );
    expect(computeTrustTier(perf, overrideOf({ degraded: true }))).toBe("degraded");
    expect(computeTrustTier(perf, overrideOf({ enabled: false }))).toBe("suspended");
  });

  it("suspended takes priority over degraded when both are set", () => {
    const perf = computeCapabilityPerformance(makeProvider({ id: "p1" }), "company-research", undefined);
    expect(computeTrustTier(perf, overrideOf({ enabled: false, degraded: true }))).toBe("suspended");
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
