import { getRuntimeConfig, RuntimeConfig } from "@/lib/config";
import { getCachedOverrides } from "@/lib/providers/overrideStore";
import { AgentProvider, Capability, ExecutionMode, ProviderOverride, ProviderSummary } from "@/types";
import { createA2AProvider } from "./adapters/a2aProvider";
import { createApolloProvider } from "./adapters/apolloProvider";
import { createBrowserExecutor } from "./adapters/browserExecutor";
import { createClayProvider } from "./adapters/clayProvider";
import { createGeminiAnalysisProvider } from "./adapters/geminiProvider";
import { createLLMAnalysisProvider } from "./adapters/llmAnalysisProvider";
import { createMCPProvider } from "./adapters/mcpProvider";
import { createOpenAIProvider } from "./adapters/openaiProvider";
import { createPersistentAgentExecutor } from "./adapters/persistentAgentExecutor";
import { createRestProvider } from "./adapters/restProvider";
import { createTavilyProvider } from "./adapters/tavilyProvider";
import { MockBrowserExecutor } from "./mock/browserExecutor";
import { MockContactProvider } from "./mock/contactProvider";
import { MockFundingProvider } from "./mock/fundingProvider";
import { MockHiringProvider } from "./mock/hiringProvider";
import { MockMCPExecutor } from "./mock/mcpMockProvider";
import { MockPersistentAgentExecutor } from "./mock/persistentAgentExecutor";
import { MockResearchProvider } from "./mock/researchProvider";
import { MockVerificationProvider } from "./mock/verificationProvider";

const MOCK_PROVIDERS: AgentProvider[] = [
  MockResearchProvider,
  MockFundingProvider,
  MockHiringProvider,
  MockContactProvider,
  MockVerificationProvider,
  MockBrowserExecutor,
  MockMCPExecutor,
  MockPersistentAgentExecutor,
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
    createOpenAIProvider(config),
    createBrowserExecutor(config),
    createPersistentAgentExecutor(config),
  ];
}

/** A degraded provider stays eligible but scores far lower and is honest about why (spec #34). */
function applyDegradation(provider: AgentProvider, override: ProviderOverride | undefined): AgentProvider {
  if (!override?.degraded) return provider;
  return {
    ...provider,
    quality_score: round2(provider.quality_score * 0.4),
    reliability_score: round2(provider.reliability_score * 0.4),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Providers eligible to actually run a given capability right now. In Demo
 * Mode this is always the mocks. In Live Mode, configured real adapters are
 * included alongside the mocks (which stay in the pool as the fallback
 * safety net) - unconfigured adapters are excluded entirely, since they
 * cannot execute. Kill switches and cost ceilings (spec #33,
 * lib/providers/overrideStore.ts) are applied before either of those checks
 * - a disabled provider is never eligible, in any mode, for any reason.
 */
export function getEligibleProviders(
  capability: Capability,
  mode: ExecutionMode,
  config: RuntimeConfig = getRuntimeConfig(),
  overrides: Record<string, ProviderOverride> = getCachedOverrides()
): AgentProvider[] {
  const all = getAllProviders(config);
  return all
    .filter((provider) => {
      if (!provider.capabilities.includes(capability)) return false;
      const override = overrides[provider.id];
      if (override?.enabled === false) return false;
      if (override?.maxCostPerTask != null && provider.price_per_task > override.maxCostPerTask) return false;
      if (mode === "demo") return provider.protocol === "mock";
      return provider.configured;
    })
    .map((provider) => applyDegradation(provider, overrides[provider.id]));
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
