import { RuntimeConfig } from "@/lib/config";
import { AgentProvider } from "@/types";
import { createPlaceholderAdapter } from "./placeholder";

/** Generic authenticated REST/webhook adapter. Configure via REST_PROVIDER_URL. */
export function createRestProvider(config: RuntimeConfig): AgentProvider {
  return createPlaceholderAdapter({
    id: "rest-provider",
    name: "Custom REST Provider",
    description: "Plain authenticated REST/webhook adapter for a bespoke internal or third-party service.",
    capabilities: ["data-validation", "summarization"],
    protocol: "webhook",
    envVarHint: "REST_PROVIDER_URL",
    configured: config.restConfigured,
    quality_score: 0.8,
    reliability_score: 0.85,
    success_rate: 0.9,
    price_per_task: 0.4,
    average_latency_seconds: 2.0,
  });
}
