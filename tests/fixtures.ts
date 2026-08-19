import {
  AgentProvider,
  Capability,
  ExecutionStep,
  ProviderCandidateScore,
  ProviderPerformanceMetrics,
  ProviderResult,
  ProviderTask,
  Task,
} from "@/types";

export function makeProvider(overrides: Partial<AgentProvider>): AgentProvider {
  return {
    id: overrides.id ?? "test-provider",
    name: overrides.name ?? "Test Provider",
    description: "Fixture provider for tests",
    capabilities: overrides.capabilities ?? ["company-research"],
    protocol: overrides.protocol ?? "mock",
    quality_score: overrides.quality_score ?? 0.8,
    reliability_score: overrides.reliability_score ?? 0.85,
    success_rate: overrides.success_rate ?? 0.9,
    price_per_task: overrides.price_per_task ?? 1,
    average_latency_seconds: overrides.average_latency_seconds ?? 3,
    configured: overrides.configured ?? true,
    async execute(): Promise<ProviderResult> {
      return {
        status: "completed",
        data: {},
        evidence: [],
        confidence: 0.9,
        cost: overrides.price_per_task ?? 1,
        duration_seconds: 0.1,
      };
    },
    async healthCheck() {
      return true;
    },
    ...overrides,
  };
}

export function alwaysFailProvider(id: string, overrides: Partial<AgentProvider> = {}): AgentProvider {
  return makeProvider({
    id,
    name: id,
    async execute(_input: ProviderTask): Promise<ProviderResult> {
      return {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: 0,
        duration_seconds: 0.05,
        error: `${id} always fails in this test`,
      };
    },
    ...overrides,
  });
}

export function makeMetrics(
  providerId: string,
  capability: Capability,
  overrides: Partial<ProviderPerformanceMetrics> = {}
): ProviderPerformanceMetrics {
  return {
    provider_id: providerId,
    capability,
    tasks_attempted: 0,
    success_rate: 0,
    average_confidence: 0,
    average_latency: 0,
    average_cost: 0,
    verification_pass_rate: 0,
    acceptance_rate: 0,
    feedback_count: 0,
    success_count: 0,
    verification_pass_count: 0,
    verification_total: 0,
    accepted_count: 0,
    rejected_count: 0,
    recent_attempts: [],
    recent_verifications: [],
    ...overrides,
  };
}

export function alwaysSucceedProvider(id: string, overrides: Partial<AgentProvider> = {}): AgentProvider {
  return makeProvider({
    id,
    name: id,
    async execute(): Promise<ProviderResult> {
      return {
        status: "completed",
        data: { ok: true },
        evidence: [],
        confidence: 0.85,
        cost: overrides.price_per_task ?? 1,
        duration_seconds: 0.05,
      };
    },
    ...overrides,
  });
}

function candidate(providerId: string, overrides: Partial<ProviderCandidateScore> = {}): ProviderCandidateScore {
  return {
    provider_id: providerId,
    provider_name: providerId,
    capability_fit: 1,
    quality_score: 0.8,
    reliability_score: 0.8,
    success_rate: 0.8,
    cost_efficiency: 0.5,
    latency_score: 0.5,
    historical_bonus: 0,
    total_score: 0.7,
    within_budget: true,
    configured: true,
    selected: false,
    explored: false,
    trust_tier: "trusted",
    ...overrides,
  };
}

export function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-1",
    capability: "company-research",
    description: "test step",
    dependencies: [],
    candidates: [],
    fallbackProviderIds: [],
    usedFallback: false,
    status: "completed",
    ...overrides,
  };
}

export function makeCompletedStep(
  id: string,
  providerId: string | undefined,
  overrides: Partial<ExecutionStep> = {}
): ExecutionStep {
  return makeStep({
    id,
    selectedProviderId: providerId,
    candidates: providerId ? [candidate(providerId, { selected: true })] : [],
    status: "completed",
    result: {
      status: "completed",
      data: {},
      evidence: [],
      confidence: 0.9,
      cost: 1,
      duration_seconds: 2,
    },
    ...overrides,
  });
}

export function makeUnmetStep(id: string, capability: Capability): ExecutionStep {
  return makeStep({
    id,
    capability,
    candidates: [],
    status: "failed",
    result: { status: "failed", data: {}, evidence: [], confidence: 0, cost: 0, duration_seconds: 0, error: "No eligible provider was available for this capability." },
  });
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    traceId: `trace-${id}`,
    rootTaskId: id,
    followUpTaskIds: [],
    workflow: "buyer-discovery",
    mode: "demo",
    raw_task: "test goal",
    created_at: new Date().toISOString(),
    quality_preference: "standard",
    routing_preference: "balanced",
    result_count: 5,
    allow_parallel: true,
    status: "completed",
    inferred_capabilities: [],
    plan: { goal: "test goal", steps: [] },
    buyer_results: [],
    excluded_results: [],
    evaluation_summary: {
      average_confidence: 0,
      total_cost: 0,
      total_latency: 0,
      providers_used: 0,
      qualified_count: 0,
      excluded_count: 0,
      evidence_coverage: 0,
      verified_claim_rate: 0,
    },
    execution_trace: [],
    ...overrides,
  };
}
