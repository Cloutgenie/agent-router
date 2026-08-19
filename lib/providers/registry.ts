import { getRuntimeConfig, RuntimeConfig } from "@/lib/config";
import { AgentProvider, Capability, ExecutionMode, ProviderSummary } from "@/types";
import { createA2AProvider } from "./adapters/a2aProvider";
import { createApolloProvider } from "./adapters/apolloProvider";
import { createClayProvider } from "./adapters/clayProvider";
import { createGeminiAnalysisProvider } from "./adapters/geminiProvider";
import { createLLMAnalysisProvider } from "./adapters/llmAnalysisProvider";
import { createMCPProvider } from "./adapters/mcpProvider";
import { createRestProvider } from "./adapters/restProvider";
import { createTavilyProvider } from "./adapters/tavilyProvider";
import { MockContactProvider } from "./mock/contactProvider";
import { MockFundingProvider } from "./mock/fundingProvider";
import { MockHiringProvider } from "./mock/hiringProvider";
import { MockResearchProvider } from "./mock/researchProvider";
import { MockVerificationProvider } from "./mock/verificationProvider";

const MOCK_PROVIDERS: AgentProvider[] = [
  MockResearchProvider,
  MockFundingProvider,
  MockHiringProvider,
  MockContactProvider,
  MockVerificationProvider,
];

/** Every provider the platform knows about - mocks (always active) plus real adapters (active once configured). */
export function getAllProviders(config: RuntimeConfig = getRuntimeConfig()): AgentProvider[] {
  return [
    ...MOCK_PROVIDERS,
    createTavilyProvider(config),
    createApolloProvider(config),
    createClayProvider(config),
    createMCPProvider(config),
    createA2AProvider(config),
    createRestProvider(config),
    createLLMAnalysisProvider(config),
    createGeminiAnalysisProvider(config),
  ];
}

/**
 * Providers eligible to actually run a given capability right now. In Demo
 * Mode this is always the mocks. In Live Mode, configured real adapters are
 * included alongside the mocks (which stay in the pool as the fallback
 * safety net) - unconfigured adapters are excluded entirely, since they
 * cannot execute.
 */
export function getEligibleProviders(
  capability: Capability,
  mode: ExecutionMode,
  config: RuntimeConfig = getRuntimeConfig()
): AgentProvider[] {
  const all = getAllProviders(config);
  return all.filter((provider) => {
    if (!provider.capabilities.includes(capability)) return false;
    if (mode === "demo") return provider.protocol === "mock";
    return provider.configured;
  });
}

export function getProviderById(id: string, config: RuntimeConfig = getRuntimeConfig()): AgentProvider | undefined {
  return getAllProviders(config).find((p) => p.id === id);
}

export function toProviderSummary(provider: AgentProvider): ProviderSummary {
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    capabilities: provider.capabilities,
    protocol: provider.protocol,
    quality_score: provider.quality_score,
    reliability_score: provider.reliability_score,
    success_rate: provider.success_rate,
    price_per_task: provider.price_per_task,
    average_latency_seconds: provider.average_latency_seconds,
    configured: provider.configured,
  };
}

export function countConnectedLiveProviders(config: RuntimeConfig = getRuntimeConfig()): number {
  return getAllProviders(config).filter((p) => p.protocol !== "mock" && p.configured).length;
}
