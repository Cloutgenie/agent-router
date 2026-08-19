import {
  AgentProvider,
  ProviderCandidateScore,
  ProviderPerformanceMetrics,
  RoutingPreference,
  TaskConstraints,
} from "@/types";

export const ROUTER_WEIGHTS = {
  capability_fit: 0.3,
  quality: 0.2,
  reliability: 0.15,
  success_rate: 0.1,
  cost_efficiency: 0.1,
  latency: 0.1,
  // historical_bonus is added directly, already scaled to roughly +/-0.05
};

/**
 * Task-level routing preference (V4 #15) - multiplies specific weight
 * groups before the score is computed. "balanced" leaves the base weights
 * untouched; the others visibly shift emphasis while keeping the same
 * transparent formula.
 */
const PREFERENCE_MULTIPLIERS: Record<
  RoutingPreference,
  { quality: number; cost: number; latency: number }
> = {
  balanced: { quality: 1, cost: 1, latency: 1 },
  "best-quality": { quality: 1.6, cost: 0.6, latency: 0.8 },
  "lowest-cost": { quality: 0.8, cost: 1.8, latency: 0.9 },
  fastest: { quality: 0.85, cost: 0.85, latency: 1.8 },
};

function weightsFor(preference: RoutingPreference) {
  const m = PREFERENCE_MULTIPLIERS[preference];
  return {
    capability_fit: ROUTER_WEIGHTS.capability_fit,
    quality: ROUTER_WEIGHTS.quality * m.quality,
    reliability: ROUTER_WEIGHTS.reliability * m.quality,
    success_rate: ROUTER_WEIGHTS.success_rate,
    cost_efficiency: ROUTER_WEIGHTS.cost_efficiency * m.cost,
    latency: ROUTER_WEIGHTS.latency * m.latency,
  };
}

function normalize(value: number, min: number, max: number, invert = false): number {
  if (max === min) return 1;
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return invert ? 1 - t : t;
}

/** Specialist providers score a touch higher than generalists on fit - a narrower tool is presumed sharper. */
function capabilityFit(provider: AgentProvider): number {
  return Math.min(1, Math.max(0.5, 1 - (provider.capabilities.length - 1) * 0.08));
}

function historicalBonus(
  provider: AgentProvider,
  metrics: ProviderPerformanceMetrics | undefined
): number {
  if (!metrics || metrics.tasks_attempted < 3) return 0;
  const successDelta = metrics.success_rate - provider.success_rate;
  let bonus = successDelta * 0.2;

  // Human feedback (V4 #22-23): repeated accepts/rejects nudge the score too.
  if (metrics.feedback_count >= 3) {
    bonus += (metrics.acceptance_rate - 0.5) * 0.06;
  }

  return round2(Math.min(0.05, Math.max(-0.05, bonus)));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RouteStepInput {
  providers: AgentProvider[];
  constraints: TaskConstraints;
  performance: Map<string, ProviderPerformanceMetrics>;
  explorationRate: number;
  /** Approximate remaining budget available to this step, if a budget was set. */
  budgetRemaining?: number;
}

export interface RouteStepResult {
  candidates: ProviderCandidateScore[];
  selectedProviderId?: string;
  fallbackProviderIds: string[];
}

/**
 * Router layer: scores every eligible provider for one capability and picks
 * a winner (plus an ordered fallback chain). Every number here is exposed
 * to the UI verbatim under "How this task was routed" - nothing is hidden.
 */
export function routeStep(input: RouteStepInput): RouteStepResult {
  const { providers, performance, explorationRate } = input;

  if (providers.length === 0) {
    return { candidates: [], fallbackProviderIds: [] };
  }

  const weights = weightsFor(input.constraints.routing_preference ?? "balanced");
  const prices = providers.map((p) => p.price_per_task);
  const latencies = providers.map((p) => p.average_latency_seconds);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  const scored: ProviderCandidateScore[] = providers.map((provider) => {
    const fit = capabilityFit(provider);
    const costEfficiency = normalize(provider.price_per_task, minPrice, maxPrice, true);
    const latencyScore = normalize(provider.average_latency_seconds, minLatency, maxLatency, true);
    const withinBudget =
      input.budgetRemaining == null || provider.price_per_task <= input.budgetRemaining;
    const bonus = historicalBonus(provider, performance.get(provider.id));

    let total =
      fit * weights.capability_fit +
      provider.quality_score * weights.quality +
      provider.reliability_score * weights.reliability +
      provider.success_rate * weights.success_rate +
      costEfficiency * weights.cost_efficiency +
      latencyScore * weights.latency +
      bonus;

    if (!withinBudget) total *= 0.5;

    return {
      provider_id: provider.id,
      provider_name: provider.name,
      capability_fit: round2(fit),
      quality_score: round2(provider.quality_score),
      reliability_score: round2(provider.reliability_score),
      success_rate: round2(provider.success_rate),
      cost_efficiency: round2(costEfficiency),
      latency_score: round2(latencyScore),
      historical_bonus: bonus,
      total_score: round2(total),
      within_budget: withinBudget,
      configured: provider.configured,
      selected: false,
      explored: false,
    };
  });

  scored.sort((a, b) => b.total_score - a.total_score);

  // Epsilon-greedy exploration: occasionally try the runner-up instead of
  // the top scorer, so the system can gather real performance data on
  // providers it would otherwise never pick. Only explores when it's safe:
  // the runner-up must still be within budget.
  let winnerIndex = 0;
  if (scored.length > 1 && scored[1].within_budget && Math.random() < explorationRate) {
    winnerIndex = 1;
    scored[1].explored = true;
  }

  scored[winnerIndex].selected = true;
  const fallbackProviderIds = scored
    .filter((_, i) => i !== winnerIndex)
    .map((c) => c.provider_id);

  return {
    candidates: scored,
    selectedProviderId: scored[winnerIndex].provider_id,
    fallbackProviderIds,
  };
}
