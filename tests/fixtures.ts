import { AgentProvider, Capability, ProviderPerformanceMetrics, ProviderResult, ProviderTask } from "@/types";

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
