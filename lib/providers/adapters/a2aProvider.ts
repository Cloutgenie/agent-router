import { RuntimeConfig } from "@/lib/config";
import { AgentProvider } from "@/types";
import { createPlaceholderAdapter } from "./placeholder";

/** Generic Agent-to-Agent (A2A) registry adapter. Configure via A2A_REGISTRY_URL. */
export function createA2AProvider(config: RuntimeConfig): AgentProvider {
  return createPlaceholderAdapter({
    id: "a2a-provider",
    name: "A2A Agent",
    description: "Agent-to-Agent protocol adapter - delegates to any registered A2A-compatible agent.",
    capabilities: ["company-research", "funding-research"],
    protocol: "a2a",
    envVarHint: "A2A_REGISTRY_URL",
    configured: config.a2aConfigured,
    quality_score: 0.87,
    reliability_score: 0.86,
    success_rate: 0.89,
    price_per_task: 1.0,
    average_latency_seconds: 4.0,
  });
}
