import { MCPToolDescriptor, MCPToolResult } from "@/types";

/**
 * Minimal, real MCP client over the "Streamable HTTP" JSON-RPC 2.0
 * transport (initialize -> notifications/initialized -> tools/list ->
 * tools/call). Handles both a plain JSON response body and an
 * `text/event-stream` framed one, and forwards the `Mcp-Session-Id` header
 * a server may return from `initialize` on every subsequent call, per the
 * MCP spec. Every request is a real HTTP round trip - there is nothing to
 * mock here, since this file has no Demo Mode counterpart (see
 * lib/providers/mock/mcpMockProvider.ts for that).
 */

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

let requestCounter = 0;
function nextId(): number {
  requestCounter += 1;
  return requestCounter;
}

async function postJsonRpc(
  serverUrl: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  sessionId?: string
): Promise<{ response: JsonRpcResponse | null; sessionId?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const res = await fetch(serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const returnedSessionId = res.headers.get("Mcp-Session-Id") ?? undefined;
    const contentType = res.headers.get("Content-Type") ?? "";
    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`MCP server returned ${res.status}: ${raw.slice(0, 200)}`);
    }
    if (!raw.trim()) {
      return { response: null, sessionId: returnedSessionId }; // notifications get no body back
    }
    if (contentType.includes("text/event-stream")) {
      const dataLines = raw.split("\n").filter((line) => line.startsWith("data:"));
      const lastData = dataLines[dataLines.length - 1]?.slice(5).trim();
      return { response: lastData ? (JSON.parse(lastData) as JsonRpcResponse) : null, sessionId: returnedSessionId };
    }
    return { response: JSON.parse(raw) as JsonRpcResponse, sessionId: returnedSessionId };
  } finally {
    clearTimeout(timer);
  }
}

export interface MCPSession {
  serverUrl: string;
  serverId: string;
  timeoutMs: number;
  sessionId?: string;
}

export async function initializeMCPSession(serverUrl: string, serverId: string, timeoutMs: number): Promise<MCPSession> {
  const initResult = await postJsonRpc(
    serverUrl,
    {
      jsonrpc: "2.0",
      id: nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "task-dropoff", version: "1.0.0" },
      },
    },
    timeoutMs
  );

  if (initResult.response?.error) {
    throw new Error(`MCP initialize failed: ${initResult.response.error.message}`);
  }

  const session: MCPSession = { serverUrl, serverId, timeoutMs, sessionId: initResult.sessionId };

  await postJsonRpc(serverUrl, { jsonrpc: "2.0", method: "notifications/initialized" }, timeoutMs, session.sessionId).catch(
    () => undefined
  );

  return session;
}

export async function listMCPTools(session: MCPSession): Promise<MCPToolDescriptor[]> {
  const { response } = await postJsonRpc(
    session.serverUrl,
    { jsonrpc: "2.0", id: nextId(), method: "tools/list" },
    session.timeoutMs,
    session.sessionId
  );
  if (response?.error) throw new Error(`MCP tools/list failed: ${response.error.message}`);
  const tools =
    (response?.result as { tools?: { name: string; description?: string; inputSchema?: unknown }[] } | undefined)?.tools ?? [];
  return tools.map((t) => ({ serverId: session.serverId, toolName: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export async function callMCPTool(
  session: MCPSession,
  toolName: string,
  input: Record<string, unknown>
): Promise<MCPToolResult> {
  const { response } = await postJsonRpc(
    session.serverUrl,
    { jsonrpc: "2.0", id: nextId(), method: "tools/call", params: { name: toolName, arguments: input } },
    session.timeoutMs,
    session.sessionId
  );
  if (response?.error) {
    return { toolName, isError: true, text: response.error.message };
  }
  const result = response?.result as { content?: { type: string; text?: string }[]; isError?: boolean } | undefined;
  const text = (result?.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
  return { toolName, isError: Boolean(result?.isError), text: text || "(no text content returned)" };
}
