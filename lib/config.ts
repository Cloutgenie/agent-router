import { ExecutionMode } from "@/types";

/**
 * Environment-based configuration. This is the single place that decides
 * Demo vs Live mode and which real provider credentials are present.
 * Nothing else in the app should read `process.env` directly.
 */
export interface RuntimeConfig {
  mode: ExecutionMode;
  explorationRate: number;
  apolloConfigured: boolean;
  clayConfigured: boolean;
  tavilyConfigured: boolean;
  geminiConfigured: boolean;
  mcpConfigured: boolean;
  a2aConfigured: boolean;
  restConfigured: boolean;
}

export function getRuntimeConfig(): RuntimeConfig {
  const liveEnabled = process.env.ENABLE_LIVE_PROVIDERS === "true";

  return {
    mode: liveEnabled ? "live" : "demo",
    explorationRate: Number(process.env.EXPLORATION_RATE ?? 0.1),
    apolloConfigured: liveEnabled && Boolean(process.env.APOLLO_API_KEY),
    clayConfigured: liveEnabled && Boolean(process.env.CLAY_API_KEY),
    tavilyConfigured: liveEnabled && Boolean(process.env.TAVILY_API_KEY),
    geminiConfigured: liveEnabled && Boolean(process.env.GEMINI_API_KEY),
    mcpConfigured: liveEnabled && Boolean(process.env.MCP_SERVER_URL),
    a2aConfigured: liveEnabled && Boolean(process.env.A2A_REGISTRY_URL),
    restConfigured: liveEnabled && Boolean(process.env.REST_PROVIDER_URL),
  };
}
