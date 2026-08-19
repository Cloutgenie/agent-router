import { RuntimeConfig } from "@/lib/config";
import { AgentProvider } from "@/types";
import { createPlaceholderAdapter } from "./placeholder";

/** Clay - enrichment waterfalls across many data sources. Configure via CLAY_API_KEY. */
export function createClayProvider(config: RuntimeConfig): AgentProvider {
  return createPlaceholderAdapter({
    id: "clay-provider",
    name: "Clay",
    description: "Enrichment waterfall across many data providers - contact and company data validation.",
    capabilities: ["contact-enrichment", "data-validation", "lead-generation"],
    protocol: "rest",
    envVarHint: "CLAY_API_KEY",
    configured: config.clayConfigured,
    quality_score: 0.89,
    reliability_score: 0.9,
    success_rate: 0.93,
    price_per_task: 0.85,
    average_latency_seconds: 3.0,
  });
}
