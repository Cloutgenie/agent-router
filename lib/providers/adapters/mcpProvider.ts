import { RuntimeConfig } from "@/lib/config";
import { AgentProvider } from "@/types";
import { createPlaceholderAdapter } from "./placeholder";

/** Generic MCP server adapter. Configure via MCP_SERVER_URL. */
export function createMCPProvider(config: RuntimeConfig): AgentProvider {
  return createPlaceholderAdapter({
    id: "mcp-provider",
    name: "MCP Server",
    description: "Generic Model Context Protocol server - any MCP tool can back this capability.",
    capabilities: ["company-research", "web-research"],
    protocol: "mcp",
    envVarHint: "MCP_SERVER_URL",
    configured: config.mcpConfigured,
    quality_score: 0.85,
    reliability_score: 0.85,
    success_rate: 0.88,
    price_per_task: 0.75,
    average_latency_seconds: 3.5,
  });
}
