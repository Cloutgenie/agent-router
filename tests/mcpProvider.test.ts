import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advertisedCapabilities, createMCPProvider } from "@/lib/providers/adapters/mcpProvider";
import { RuntimeConfig } from "@/lib/config";
import { ProviderTask } from "@/types";

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    mode: "live",
    explorationRate: 0.1,
    apolloConfigured: false,
    clayConfigured: false,
    tavilyConfigured: false,
    geminiConfigured: false,
    mcpConfigured: true,
    mcpGrantedScopes: [],
    a2aConfigured: false,
    restConfigured: false,
    browserExecutionConfigured: false,
    maxBrowserPagesPerTask: 10,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProviderTask> = {}): ProviderTask {
  return {
    taskId: "t1",
    traceId: "trace-1",
    stepId: "step-1",
    capability: "web-research",
    goal: "test goal",
    context: {},
    resultCount: 5,
    ...overrides,
  };
}

describe("MCP permission scopes", () => {
  it("advertises read-scoped capabilities by default once the server is configured", () => {
    const capabilities = advertisedCapabilities(makeConfig());
    expect(capabilities).toContain("crm-read");
    expect(capabilities).toContain("email-read");
    expect(capabilities).toContain("calendar-read");
    expect(capabilities).toContain("file-read");
    expect(capabilities).toContain("web-research");
  });

  it("never advertises write/send-scoped capabilities without an explicit grant", () => {
    const capabilities = advertisedCapabilities(makeConfig());
    expect(capabilities).not.toContain("crm-write");
    expect(capabilities).not.toContain("email-send");
    expect(capabilities).not.toContain("calendar-write");
    expect(capabilities).not.toContain("file-write");
  });

  it("advertises a write-scoped capability once its exact scope is granted", () => {
    const capabilities = advertisedCapabilities(makeConfig({ mcpGrantedScopes: ["crm.write"] }));
    expect(capabilities).toContain("crm-write");
    // Granting one write scope must not implicitly grant another.
    expect(capabilities).not.toContain("email-send");
  });

  it("never advertises company-research, regardless of configuration", () => {
    const capabilities = advertisedCapabilities(makeConfig({ mcpGrantedScopes: ["crm.write", "email.send"] }));
    expect(capabilities).not.toContain("company-research");
  });

  it("blocks execute() for an ungranted write scope before any network call", async () => {
    process.env.MCP_SERVER_URL = "https://example-mcp.test/rpc";
    const provider = createMCPProvider(makeConfig({ mcpGrantedScopes: [] }));

    const result = await provider.execute(makeTask({ capability: "crm-write" }));

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/requires the "crm.write" permission scope/);
    delete process.env.MCP_SERVER_URL;
  });
});

describe("MCP JSON-RPC client (mocked server)", () => {
  const originalFetch = global.fetch;

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  beforeEach(() => {
    process.env.MCP_SERVER_URL = "https://example-mcp.test/rpc";
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      switch (body.method) {
        case "initialize":
          return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } });
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return jsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { tools: [{ name: "crm.write_contact", description: "Write a contact to CRM" }] },
          });
        case "tools/call":
          return jsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: "Contact written." }], isError: false },
          });
        default:
          return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
      }
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.MCP_SERVER_URL;
  });

  it("completes a granted write-scope call end-to-end via initialize -> tools/list -> tools/call", async () => {
    const provider = createMCPProvider(makeConfig({ mcpGrantedScopes: ["crm.write"] }));

    const result = await provider.execute(makeTask({ capability: "crm-write", goal: "Log this contact to the CRM" }));

    expect(result.status).toBe("completed");
    expect(result.data.toolName).toBe("crm.write_contact");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].excerpt).toContain("Contact written.");
  });

  it("surfaces a tool-level error as a failed result rather than throwing", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") {
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "web.search" }] } });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "rate limited" }], isError: true },
      });
    }) as unknown as typeof fetch;

    const provider = createMCPProvider(makeConfig());
    const result = await provider.execute(makeTask({ capability: "web-research" }));

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/rate limited/);
  });
});
