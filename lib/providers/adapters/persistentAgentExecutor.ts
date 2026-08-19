import { RuntimeConfig } from "@/lib/config";
import { ProviderNotImplementedError } from "./placeholder";
import { PersistentAgentExecutor, PersistentExecution, ProviderResult, ProviderTask } from "@/types";

/**
 * Persistent agent executor shell (spec #9) - for systems capable of longer-
 * lived computer/browser/terminal work (persistent browser workers,
 * computer-use workers, terminal agents, cloud computer agents, a future
 * Grok/xAI-style persistent agent, or any other third-party worker).
 *
 * No concrete vendor here has a settled, publicly documented programmatic
 * contract to build a real integration against - unlike Tavily/Gemini/MCP,
 * which are real integrations elsewhere in lib/providers/adapters/. Per the
 * explicit instruction this shell was built against: never fabricate an
 * integration. So this file exists to get the architecture right -
 * `PersistentAgentExecutor`'s full lifecycle (start -> poll status -> get
 * result, plus optional resume/cancel), real health/configuration states,
 * and a documented, disabled-by-default live path - while `execute()` and
 * every lifecycle method throws a clear `ProviderNotImplementedError` if
 * ever actually reached. Because `configured` only becomes true once an
 * operator sets ENABLE_PERSISTENT_AGENTS=true *and* points
 * PERSISTENT_AGENT_API_URL at a real, wired-up worker, that throw is
 * unreachable by default - the router never selects an unconfigured
 * adapter. See lib/providers/mock/persistentAgentExecutor.ts for the Demo
 * Mode stand-in that actually exercises this lifecycle end to end.
 */
export function createPersistentAgentExecutor(config: RuntimeConfig): PersistentAgentExecutor {
  const envVarHint = "PERSISTENT_AGENT_API_URL";

  const notImplemented = (): never => {
    throw new ProviderNotImplementedError("persistent-agent-executor", envVarHint);
  };

  return {
    id: "persistent-agent-executor",
    name: "Persistent Agent Worker",
    description:
      "Long-running computer/browser/terminal worker shell - architecture only until a specific vendor is wired up.",
    capabilities: ["long-running-task", "authenticated-browser", "terminal-execution", "agent-delegation"],
    protocol: "persistent_agent",
    quality_score: 0.8,
    reliability_score: 0.75,
    success_rate: 0.8,
    price_per_task: 1.5,
    average_latency_seconds: 20,
    configured: config.persistentAgentConfigured,

    async execute(_task: ProviderTask): Promise<ProviderResult> {
      return notImplemented();
    },

    async healthCheck(): Promise<boolean> {
      return false;
    },

    async startTask(_input: ProviderTask): Promise<PersistentExecution> {
      return notImplemented();
    },

    async getStatus(_executionId: string): Promise<PersistentExecution> {
      return notImplemented();
    },

    async resumeTask(_executionId: string): Promise<ProviderResult> {
      return notImplemented();
    },

    async cancelTask(_executionId: string): Promise<void> {
      notImplemented();
    },
  };
}
