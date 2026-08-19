import { RuntimeConfig } from "@/lib/config";
import { AgentProvider } from "@/types";
import { createPlaceholderAdapter } from "./placeholder";

/** Apollo.io - contact and lead database. Configure via APOLLO_API_KEY. */
export function createApolloProvider(config: RuntimeConfig): AgentProvider {
  return createPlaceholderAdapter({
    id: "apollo-provider",
    name: "Apollo",
    description: "Contact and lead database - decision-maker discovery and contact enrichment.",
    capabilities: ["contact-enrichment", "lead-generation", "company-research"],
    protocol: "rest",
    envVarHint: "APOLLO_API_KEY",
    configured: config.apolloConfigured,
    quality_score: 0.92,
    reliability_score: 0.93,
    success_rate: 0.95,
    price_per_task: 1.2,
    average_latency_seconds: 2.0,
  });
}
