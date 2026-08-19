import { Agent, Capability, RoutingCandidate, TaskConstraints } from "@/types";

export const SCORING_WEIGHTS = {
  capability_fit: 0.4,
  quality: 0.2,
  reliability: 0.15,
  success_rate: 0.1,
  cost_efficiency: 0.1,
  latency: 0.05,
};

/** Min-max normalize a value into 0-1. `invert` flips it (lower raw value = higher score). */
function normalize(value: number, min: number, max: number, invert = false): number {
  if (max === min) return 1;
  const t = (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, t));
  return invert ? 1 - clamped : clamped;
}

function qualityFloorFor(constraints: TaskConstraints): number {
  switch (constraints.quality_preference) {
    case "best":
      return 0.85;
    case "high":
      return 0.75;
    default:
      return 0;
  }
}

/**
 * Scores every active, capability-relevant agent against a required
 * capability set. The formula is intentionally exposed in full on every
 * candidate so the UI can show why an agent won or lost - nothing here is
 * a black box.
 */
export function scoreCandidates(
  requiredCapabilities: Capability[],
  agents: Agent[],
  constraints: TaskConstraints
): RoutingCandidate[] {
  const eligible = agents.filter(
    (agent) =>
      agent.active &&
      agent.capabilities.some((c) => requiredCapabilities.includes(c))
  );

  const qualityFloor = qualityFloorFor(constraints);
  const gated = eligible.filter((agent) => agent.quality_score >= qualityFloor);
  const pool = gated.length > 0 ? gated : eligible;

  if (pool.length === 0) return [];

  const prices = pool.map((a) => a.price_per_task);
  const latencies = pool.map((a) => a.average_latency_seconds);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  const candidates: RoutingCandidate[] = pool.map((agent) => {
    const matched = agent.capabilities.filter((c) =>
      requiredCapabilities.includes(c)
    );
    const missing = requiredCapabilities.filter(
      (c) => !agent.capabilities.includes(c)
    );
    const capability_fit = matched.length / requiredCapabilities.length;
    const cost_efficiency = normalize(agent.price_per_task, minPrice, maxPrice, true);
    const latency_score = normalize(
      agent.average_latency_seconds,
      minLatency,
      maxLatency,
      true
    );
    const within_budget =
      constraints.budget == null || agent.price_per_task <= constraints.budget;

    let total_score =
      capability_fit * SCORING_WEIGHTS.capability_fit +
      agent.quality_score * SCORING_WEIGHTS.quality +
      agent.reliability_score * SCORING_WEIGHTS.reliability +
      agent.success_rate * SCORING_WEIGHTS.success_rate +
      cost_efficiency * SCORING_WEIGHTS.cost_efficiency +
      latency_score * SCORING_WEIGHTS.latency;

    if (!within_budget) total_score *= 0.5;

    return {
      agent,
      matched_capabilities: matched,
      missing_capabilities: missing,
      capability_fit: round2(capability_fit),
      quality_score: round2(agent.quality_score),
      reliability_score: round2(agent.reliability_score),
      success_rate: round2(agent.success_rate),
      cost_efficiency: round2(cost_efficiency),
      latency_score: round2(latency_score),
      total_score: round2(total_score),
      within_budget,
      selected: false,
    };
  });

  return candidates.sort((a, b) => b.total_score - a.total_score);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
