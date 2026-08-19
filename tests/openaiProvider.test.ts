import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "@/lib/providers/adapters/openaiProvider";
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
    mcpConfigured: false,
    mcpGrantedScopes: [],
    a2aConfigured: false,
    restConfigured: false,
    browserExecutionConfigured: false,
    browserbaseConfigured: false,
    maxBrowserPagesPerTask: 10,
    persistentAgentConfigured: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProviderTask> = {}): ProviderTask {
  return {
    taskId: "t1",
    traceId: "trace-1",
    stepId: "step-1",
    capability: "ai-adoption-signal",
    goal: "assess AI adoption",
    context: { companies: [{ name: "Acme AI", website: "acmeai.example" }] },
    resultCount: 5,
    ...overrides,
  };
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAIProvider", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("fails cleanly when the API key is missing, without ever calling fetch", async () => {
    delete process.env.OPENAI_API_KEY;
    global.fetch = vi.fn();
    const provider = createOpenAIProvider(makeConfig());

    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/OPENAI_API_KEY/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parses a valid JSON response into an AI-signal claim", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages[0].role).toBe("system");
      return chatResponse(JSON.stringify({ signal_detected: true, summary: "Ships an AI-based detection model.", confidence: 0.88 }));
    }) as unknown as typeof fetch;

    const provider = createOpenAIProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("completed");
    const byCompany = result.data.byCompany as Record<string, { aiSignal: string }>;
    expect(byCompany["Acme AI"].aiSignal).toBe("Ships an AI-based detection model.");
    expect(result.evidence[0].confidence).toBe(0.88);
  });

  it("repairs one malformed response before giving up", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return chatResponse("not json at all");
      return chatResponse(JSON.stringify({ signal_detected: false, summary: "No AI signal found.", confidence: 0.4 }));
    }) as unknown as typeof fetch;

    const provider = createOpenAIProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("completed");
    expect(call).toBe(2);
    const byCompany = result.data.byCompany as Record<string, { aiSignal: string }>;
    expect(byCompany["Acme AI"].aiSignal).toContain("No AI adoption signal detected");
  });

  it("fails the step (not the process) after two consecutive malformed responses", async () => {
    global.fetch = vi.fn(async () => chatResponse("still not json")) as unknown as typeof fetch;

    const provider = createOpenAIProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/valid JSON/);
  });

  it("fails cleanly on an API error status", async () => {
    global.fetch = vi.fn(async () => new Response("server error", { status: 500 })) as unknown as typeof fetch;

    const provider = createOpenAIProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/500/);
  });
});
