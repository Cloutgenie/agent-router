import { ExecutionMode, MCPPermissionScope } from "@/types";

const ALL_MCP_SCOPES: MCPPermissionScope[] = [
  "crm.read",
  "crm.write",
  "email.read",
  "email.send",
  "calendar.read",
  "calendar.write",
  "files.read",
  "files.write",
];

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
  xaiConfigured: boolean;
  mcpConfigured: boolean;
  /** Write-capable MCP scopes explicitly allowlisted via MCP_GRANTED_SCOPES - never assumed. */
  mcpGrantedScopes: MCPPermissionScope[];
  a2aConfigured: boolean;
  restConfigured: boolean;
  browserExecutionConfigured: boolean;
  /** Real Browserbase session (JS-rendered pages via CDP) vs. the static-fetch fallback. */
  browserbaseConfigured: boolean;
  maxBrowserPagesPerTask: number;
  /** No concrete vendor is wired yet - see lib/providers/adapters/persistentAgentExecutor.ts. Always false until one is. */
  persistentAgentConfigured: boolean;
}

function parseGrantedScopes(raw: string | undefined): MCPPermissionScope[] {
  if (!raw) return [];
  const requested = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ALL_MCP_SCOPES.filter((scope) => requested.includes(scope));
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
    xaiConfigured: liveEnabled && Boolean(process.env.XAI_API_KEY),
    mcpConfigured: liveEnabled && Boolean(process.env.MCP_SERVER_URL),
    mcpGrantedScopes: liveEnabled ? parseGrantedScopes(process.env.MCP_GRANTED_SCOPES) : [],
    a2aConfigured: liveEnabled && Boolean(process.env.A2A_REGISTRY_URL),
    restConfigured: liveEnabled && Boolean(process.env.REST_PROVIDER_URL),
    browserExecutionConfigured: liveEnabled && process.env.ENABLE_BROWSER_EXECUTION === "true",
    browserbaseConfigured:
      liveEnabled &&
      process.env.ENABLE_BROWSER_EXECUTION === "true" &&
      Boolean(process.env.BROWSERBASE_API_KEY) &&
      Boolean(process.env.BROWSERBASE_PROJECT_ID),
    maxBrowserPagesPerTask: Number(process.env.MAX_BROWSER_PAGES_PER_TASK ?? 10),
    persistentAgentConfigured:
      liveEnabled &&
      process.env.ENABLE_PERSISTENT_AGENTS === "true" &&
      Boolean(process.env.PERSISTENT_AGENT_API_URL),
  };
}
