import { RuntimeConfig } from "@/lib/config";
import { callMCPTool, initializeMCPSession, listMCPTools } from "@/lib/providers/mcp/client";
import { makeEvidence } from "@/lib/providers/shared";
import { AgentProvider, Capability, MCPPermissionScope, MCPToolDescriptor, ProviderResult, ProviderTask } from "@/types";

/**
 * Generic MCP server adapter (spec #25-26) - a real JSON-RPC client
 * (lib/providers/mcp/client.ts), not a placeholder. Deliberately never
 * advertises `company-research`: an arbitrary MCP server's tool output
 * won't match the `{ companies, byCompany }` shape the flagship discovery
 * step requires, and a real adapter that can actually complete (unlike the
 * old always-throwing placeholder) could otherwise get routed to that step
 * and silently produce zero results.
 *
 * Permission scopes (spec #26): read-scoped capabilities are available as
 * soon as the server itself is configured. Write/send-scoped capabilities
 * additionally require their exact scope to be present in
 * MCP_GRANTED_SCOPES - the router never even sees them as eligible
 * otherwise, so it can't select a tool call nobody approved.
 */

export const CAPABILITY_SCOPE: Partial<Record<Capability, MCPPermissionScope>> = {
  "crm-read": "crm.read",
  "crm-write": "crm.write",
  "email-read": "email.read",
  "email-send": "email.send",
  "calendar-read": "calendar.read",
  "calendar-write": "calendar.write",
  "file-read": "files.read",
  "file-write": "files.write",
};

const CAPABILITY_KEYWORDS: Partial<Record<Capability, string[]>> = {
  "web-research": ["search", "web", "fetch", "browse"],
  "crm-read": ["crm"],
  "crm-write": ["crm"],
  "email-read": ["email", "mail", "inbox"],
  "email-send": ["email", "mail", "send"],
  "calendar-read": ["calendar", "schedule"],
  "calendar-write": ["calendar", "schedule", "event"],
  "file-read": ["file", "document", "drive"],
  "file-write": ["file", "document", "drive", "upload"],
};

export function isWriteScope(scope: MCPPermissionScope): boolean {
  return scope.endsWith(".write") || scope.endsWith(".send");
}

/** What this server is eligible to be routed for right now, given its granted scopes - computed once at registration time. */
export function advertisedCapabilities(config: RuntimeConfig): Capability[] {
  const capabilities: Capability[] = ["web-research"];
  for (const [capability, scope] of Object.entries(CAPABILITY_SCOPE) as [Capability, MCPPermissionScope][]) {
    if (isWriteScope(scope)) {
      if (config.mcpGrantedScopes.includes(scope)) capabilities.push(capability);
    } else {
      capabilities.push(capability);
    }
  }
  return capabilities;
}

function pickTool(tools: MCPToolDescriptor[], capability: Capability): MCPToolDescriptor | undefined {
  if (tools.length === 0) return undefined;
  const keywords = CAPABILITY_KEYWORDS[capability] ?? [];
  const scored = tools.map((t) => {
    const haystack = `${t.toolName} ${t.description ?? ""}`.toLowerCase();
    return { tool: t, score: keywords.filter((k) => haystack.includes(k)).length };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].tool : tools[0];
}

function serverIdFrom(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return "mcp-server";
  }
}

export function createMCPProvider(config: RuntimeConfig): AgentProvider {
  const serverUrl = process.env.MCP_SERVER_URL ?? "";
  const serverId = process.env.MCP_SERVER_NAME || (serverUrl ? serverIdFrom(serverUrl) : "mcp-server");
  const timeoutMs = Number(process.env.DEFAULT_EXECUTION_TIMEOUT_MS ?? 30000);
  const capabilities = config.mcpConfigured ? advertisedCapabilities(config) : ["web-research" as Capability];

  return {
    id: "mcp-provider",
    name: `MCP: ${serverId}`,
    description: "Generic Model Context Protocol server - any MCP tool can back an eligible capability.",
    capabilities,
    protocol: "mcp",
    quality_score: 0.85,
    reliability_score: 0.85,
    success_rate: 0.88,
    price_per_task: 0.75,
    average_latency_seconds: 3.5,
    configured: config.mcpConfigured,

    async execute(task: ProviderTask): Promise<ProviderResult> {
      if (!config.mcpConfigured || !serverUrl) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "MCP server is not configured - missing MCP_SERVER_URL.",
        };
      }

      const requiredScope = CAPABILITY_SCOPE[task.capability];
      if (requiredScope && isWriteScope(requiredScope) && !config.mcpGrantedScopes.includes(requiredScope)) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: `Blocked: "${task.capability}" requires the "${requiredScope}" permission scope, which has not been granted (set MCP_GRANTED_SCOPES).`,
        };
      }

      const started = Date.now();
      try {
        const session = await initializeMCPSession(serverUrl, serverId, timeoutMs);
        const tools = await listMCPTools(session);
        const tool = pickTool(tools, task.capability);
        if (!tool) {
          return {
            status: "failed",
            data: {},
            evidence: [],
            confidence: 0,
            cost: 0,
            duration_seconds: (Date.now() - started) / 1000,
            error: `No tool on MCP server "${serverId}" matched capability "${task.capability}".`,
          };
        }

        const result = await callMCPTool(session, tool.toolName, { query: task.goal });
        if (result.isError) {
          return {
            status: "failed",
            data: {},
            evidence: [],
            confidence: 0,
            cost: 0,
            duration_seconds: (Date.now() - started) / 1000,
            error: `MCP tool "${tool.toolName}" returned an error: ${result.text}`,
          };
        }

        const evidence = [
          makeEvidence({
            type: "provider_output",
            title: `MCP tool result - ${tool.toolName}`,
            source: `MCP: ${serverId}/${tool.toolName}`,
            excerpt: result.text.slice(0, 300),
            confidence: 0.7,
            sourceQuality: "medium",
            query: task.goal,
          }),
        ];

        return {
          status: "completed",
          data: { toolName: result.toolName, raw: result.text },
          evidence,
          confidence: 0.7,
          cost: this.price_per_task,
          duration_seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
        };
      } catch (err) {
        return {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: (Date.now() - started) / 1000,
          error: err instanceof Error ? err.message : "MCP call failed",
        };
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!config.mcpConfigured || !serverUrl) return false;
      try {
        await initializeMCPSession(serverUrl, serverId, Math.min(timeoutMs, 5000));
        return true;
      } catch {
        return false;
      }
    },
  };
}
