import {
  AgentProvider,
  Capability,
  CapabilityPerformance,
  ExecutionOffer,
  ProviderOverride,
  ProviderPerformanceMetrics,
  TimestampedOutcome,
  TrustTier,
} from "@/types";

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

/**
 * Reputation decay (V7 #13): recent outcomes count more than old ones.
 * Bucketed exactly as the spec's own example (last 30 days highest, 31-90
 * medium-high, 91-180 medium, 180+ lower) rather than a continuous decay
 * curve, so the weight any given outcome carries stays easy to state in
 * plain language.
 */
function recencyWeight(timestamp: string, now: number): number {
  const ageDays = (now - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.6;
  if (ageDays <= 180) return 0.3;
  return 0.1;
}

/**
 * Wilson lower bound over recency-weighted counts instead of raw counts - an
 * old, sparse tail of events naturally produces a small effective sample
 * size (wide interval, pulled toward 0.5), exactly like too few events would
 * with the unweighted version. Lifetime totals (via `metrics.success_count`
 * etc.) are never touched by this - "don't erase long-term history."
 */
function recencyWeightedWilsonBound(events: TimestampedOutcome[], now: number): number {
  if (events.length === 0) return 0.5;
  let weightedSuccesses = 0;
  let weightedTotal = 0;
  for (const event of events) {
    const w = recencyWeight(event.timestamp, now);
    weightedTotal += w;
    if (event.passed) weightedSuccesses += w;
  }
  return wilsonLowerBound(weightedSuccesses, weightedTotal);
}

/**
 * Blends the recency-weighted read above with the lifetime Wilson bound -
 * "use both recency and lifetime reliability" (V7 #13), not one or the
 * other. Recency-weighted gets more say (0.65) since it's the whole point
 * of decay, but lifetime (0.35) keeps a long, quiet track record from being
 * swamped by a handful of recent events alone.
 */
function decayedRate(recentEvents: TimestampedOutcome[], lifetimeSuccesses: number, lifetimeTotal: number, now: number): number {
  const lifetime = wilsonLowerBound(lifetimeSuccesses, lifetimeTotal);
  // No recency log yet - e.g. lifetime totals that predate this field being
  // added. Fall back to pure lifetime rather than blending in a neutral 0.5
  // that would drag a perfectly good long-run track record toward "unknown."
  if (recentEvents.length === 0) return lifetime;
  const recencyWeighted = recencyWeightedWilsonBound(recentEvents, now);
  return recencyWeighted * 0.65 + lifetime * 0.35;
}

export function computeCapabilityPerformance(
  provider: AgentProvider,
  capability: Capability,
  metrics: ProviderPerformanceMetrics | undefined,
  now: number = Date.now()
): CapabilityPerformance {
  const n = metrics?.tasks_attempted ?? 0;
  const successRate = decayedRate(metrics?.recent_attempts ?? [], metrics?.success_count ?? 0, n, now);
  const verificationRate = decayedRate(
    metrics?.recent_verifications ?? [],
    metrics?.verification_pass_count ?? 0,
    metrics?.verification_total ?? 0,
    now
  );
  // No recency log for accept/reject feedback yet (deliberately deferred - see README) - lifetime Wilson only.
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

/** Mirrors autoSafety.ts's MIN_SAMPLE_SIZE (5) - same "not enough data to trust a rate" threshold, applied to job count instead of a failure/verification rate. */
const PROBATION_JOB_THRESHOLD = 5;

/**
 * Executor standing for one capability (V7 #35-36). Reuses existing state
 * rather than re-deciding it: "suspended"/"degraded" read the kill-switch/
 * auto-safety override verbatim (that machinery already decides and
 * enforces this - see lib/policy/autoSafety.ts, which explicitly never
 * auto-recovers; only a manual override clears it). "new"/"probation"/
 * "trusted" are newly derived here, from job count alone - genuinely new
 * information this function is the only source of.
 */
export function computeTrustTier(perf: CapabilityPerformance, override: ProviderOverride | undefined): TrustTier {
  if (override?.enabled === false) return "suspended";
  if (override?.degraded === true) return "degraded";
  if (perf.jobsCompleted === 0) return "new";
  if (perf.jobsCompleted < PROBATION_JOB_THRESHOLD) return "probation";
  return "trusted";
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
