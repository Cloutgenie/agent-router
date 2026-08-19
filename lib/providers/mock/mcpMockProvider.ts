import { AgentProvider, Capability, Evidence, MCPToolDescriptor, MCPToolResult, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, round2, sleep } from "../shared";

const DEMO_TOOLS: MCPToolDescriptor[] = [
  { serverId: "demo-mcp", toolName: "web.search", description: "Search the open web for a query." },
  { serverId: "demo-mcp", toolName: "web.fetch", description: "Fetch and summarize a single URL." },
  { serverId: "demo-mcp", toolName: "crm.write_contact", description: "Write a contact record to the CRM." },
  { serverId: "demo-mcp", toolName: "email.send", description: "Send an email." },
  { serverId: "demo-mcp", toolName: "calendar.create_event", description: "Create a calendar event." },
  { serverId: "demo-mcp", toolName: "file.write", description: "Write a file to connected storage." },
];

const TOOL_FOR_CAPABILITY: Partial<Record<Capability, string>> = {
  "crm-write": "crm.write_contact",
  "email-send": "email.send",
  "calendar-write": "calendar.create_event",
  "file-write": "file.write",
};

/**
 * Demo-mode stand-in for a generic MCP tool server (spec #68 - Demo Mode
 * needs a mock MCP, same as it needs mock search/enrichment/LLM). Only
 * declares `web-research` plus the write-capable capabilities the approval
 * workflow exists to gate - never `company-research` - so it can never be
 * routed to the flagship discovery step, whose result shape it doesn't
 * produce (see the real MCPExecutor for why that boundary matters).
 *
 * The write-capable tool calls here are simulated against fictional data,
 * clearly labeled "[DEMO SIMULATION]" - this lets Demo Mode show the full
 * approve -> route -> execute flow end to end (spec #28) without ever
 * pretending a real email got sent or a real CRM got written to.
 */
export const MockMCPExecutor: AgentProvider & {
  listTools: () => Promise<MCPToolDescriptor[]>;
  callTool: (toolName: string, input: Record<string, unknown>) => Promise<MCPToolResult>;
} = {
  id: "mcp-mock",
  name: "MCP Tool (Demo)",
  description: "Simulated Model Context Protocol tool server - demonstrates MCP-backed execution with zero credentials.",
  capabilities: ["web-research", "crm-write", "email-send", "calendar-write", "file-write"],
  protocol: "mock",
  quality_score: 0.82,
  reliability_score: 0.85,
  success_rate: 0.9,
  price_per_task: 0.5,
  average_latency_seconds: 2.8,
  configured: true,

  async listTools(): Promise<MCPToolDescriptor[]> {
    return DEMO_TOOLS;
  },

  async callTool(toolName: string, input: Record<string, unknown>): Promise<MCPToolResult> {
    return {
      toolName,
      isError: false,
      text: `[DEMO SIMULATION] Simulated ${toolName} call for ${JSON.stringify(input).slice(0, 120)}`,
    };
  },

  async execute(task: ProviderTask): Promise<ProviderResult> {
    const simulatedSeconds = Math.max(0.6, jitter(this.average_latency_seconds, 1));
    await sleep(Math.min(simulatedSeconds * 300, 2200));

    if (Math.random() > this.success_rate) {
      return {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: round2(this.price_per_task * 0.4),
        duration_seconds: round2(simulatedSeconds),
        error: `${this.name} tool call failed (simulated failure).`,
      };
    }

    const toolName = TOOL_FOR_CAPABILITY[task.capability] ?? "web.search";
    const result = await this.callTool(toolName, { query: task.goal });
    const evidence: Evidence[] = [
      makeEvidence({
        type: "provider_output",
        title: `MCP tool result - ${toolName}`,
        source: "MCP Tool (Demo)",
        excerpt: result.text,
        confidence: round2(jitter(this.quality_score, 0.05)),
        sourceQuality: "medium",
        query: task.goal,
      }),
    ];

    return {
      status: "completed",
      data: { toolName: result.toolName, raw: result.text },
      evidence,
      confidence: round2(Math.min(0.95, Math.max(0.5, jitter(this.quality_score, 0.06)))),
      cost: this.price_per_task,
      duration_seconds: round2(simulatedSeconds),
    };
  },

  async healthCheck() {
    await sleep(30);
    return true;
  },
};
