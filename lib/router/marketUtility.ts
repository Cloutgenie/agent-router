import { AgentProvider, Capability, CapabilityPerformance, ExecutionOffer, ProviderPerformanceMetrics } from "@/types";

/**
 * Execution market core (V7 #1-9): turns the existing performance store into
 * a sample-size-corrected, capability-specific reputation view
 * (CapabilityPerformance), a per-executor quote (ExecutionOffer), and a
 * transparent utility function for "Market Optimal" routing. Deliberately
 * no ML, no black box - every number here is a documented formula over data
 * lib/history/performanceStore.ts already tracks.
 */

/**
 * Wilson score lower bound - a sample-size-corrected estimate of a true
 * proportion. A provider with 2/2 successes and one with 950/1000 both
 * "look" like ~100%/95% as raw rates; Wilson pulls the low-sample one toward
 * the neutral 0.5 prior much harder, so a lucky small streak can't outrank a
 * large, consistently strong sample (spec #12's "2 perfect tasks must not
 * outrank 2,000 strong tasks").
 */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0.5; // no data yet - neutral prior, not zero
  const phat = successes / total;
  const denom = 1 + (z * z) / total;
  const center = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

/**
 * Linear shrinkage toward a prior, for continuous (non pass/fail) metrics
 * like latency/cost/quality - the same "don't trust a tiny sample" instinct
 * as Wilson, for values Wilson's proportion math doesn't apply to. `k`
 * controls how many observations it takes to mostly trust the observed
 * average over the static provider prior.
 */
function shrinkToward(observed: number, prior: number, sampleSize: number, k = 5): number {
  const weight = sampleSize / (sampleSize + k);
  return observed * weight + prior * (1 - weight);
}

export function computeCapabilityPerformance(
  provider: AgentProvider,
  capability: Capability,
  metrics: ProviderPerformanceMetrics | undefined
): CapabilityPerformance {
  const n = metrics?.tasks_attempted ?? 0;
  const successRate = wilsonLowerBound(metrics?.success_count ?? 0, n);
  const verificationRate = wilsonLowerBound(metrics?.verification_pass_count ?? 0, metrics?.verification_total ?? 0);
  const feedbackN = (metrics?.accepted_count ?? 0) + (metrics?.rejected_count ?? 0);
  const humanAcceptanceRate = wilsonLowerBound(metrics?.accepted_count ?? 0, feedbackN);

  const avgQuality = shrinkToward(metrics?.average_confidence ?? provider.quality_score, provider.quality_score, n);
  const avgLatencyMs = shrinkToward(
    metrics ? metrics.average_latency * 1000 : provider.average_latency_seconds * 1000,
    provider.average_latency_seconds * 1000,
    n
  );
  const avgCost = shrinkToward(metrics?.average_cost ?? provider.price_per_task, provider.price_per_task, n);

  const confidenceAdjustedScore = round2(successRate * 0.4 + verificationRate * 0.4 + humanAcceptanceRate * 0.2);

  return {
    executorId: provider.id,
    capability,
    jobsCompleted: n,
    successRate: round2(successRate),
    verificationRate: round2(verificationRate),
    humanAcceptanceRate: round2(humanAcceptanceRate),
    avgQuality: round2(avgQuality),
    avgLatencyMs: Math.round(avgLatencyMs),
    avgCost: round2(avgCost),
    failureRate: round2(1 - successRate),
    fallbackRate: 0, // not tracked yet - see CapabilityPerformance.fallbackRate doc
    confidenceAdjustedScore,
  };
}

export function buildExecutionOffer(provider: AgentProvider, perf: CapabilityPerformance): ExecutionOffer {
  return {
    executorId: provider.id,
    capability: perf.capability,
    estimatedCost: provider.price_per_task,
    estimatedLatencyMs: perf.avgLatencyMs,
    estimatedQuality: perf.avgQuality,
    estimatedVerificationRate: perf.verificationRate,
    reliability: perf.successRate,
    confidence: Math.min(1, round2(perf.jobsCompleted / 20)),
    available: provider.configured,
  };
}

/** Market Optimal's utility weights (V7 #8) - transparent and documented on purpose, no opaque ML. */
export const UTILITY_WEIGHTS = {
  quality: 0.25,
  verification: 0.25,
  reliability: 0.2,
  acceptance: 0.1,
  cost: 0.1,
  latency: 0.1,
};

/**
 * `normalizedCost`/`normalizedLatency` are 0 (cheapest/fastest of the
 * eligible pool for this step) to 1 (priciest/slowest) - the same
 * cross-candidate normalization the standard scoring path already computes
 * for cost_efficiency/latency_score, just not pre-inverted.
 */
export function computeUtility(perf: CapabilityPerformance, normalizedCost: number, normalizedLatency: number): number {
  return round2(
    UTILITY_WEIGHTS.quality * perf.avgQuality +
      UTILITY_WEIGHTS.verification * perf.verificationRate +
      UTILITY_WEIGHTS.reliability * perf.successRate +
      UTILITY_WEIGHTS.acceptance * perf.humanAcceptanceRate -
      UTILITY_WEIGHTS.cost * normalizedCost -
      UTILITY_WEIGHTS.latency * normalizedLatency
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
