import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCursorProvider } from "@/lib/providers/adapters/cursorProvider";
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
    xaiConfigured: false,
    mcpConfigured: false,
    mcpGrantedScopes: [],
    a2aConfigured: false,
    restConfigured: false,
    browserExecutionConfigured: false,
    browserbaseConfigured: false,
    maxBrowserPagesPerTask: 10,
    persistentAgentConfigured: false,
    cursorConfigured: true,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProviderTask> = {}): ProviderTask {
  return {
    taskId: "t1",
    traceId: "trace-1",
    stepId: "step-1",
    capability: "agent-delegation",
    goal: "Add a README badge",
    context: { repos: [{ url: "https://github.com/acme/widgets" }] },
    resultCount: 5,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("CursorProvider", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    process.env.CURSOR_API_KEY = "test-key";
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.CURSOR_API_KEY = originalKey;
    vi.useRealTimers();
  });

  it("configured reflects RuntimeConfig.cursorConfigured, not just whether a key is set", () => {
    expect(createCursorProvider(makeConfig({ cursorConfigured: true })).configured).toBe(true);
    expect(createCursorProvider(makeConfig({ cursorConfigured: false })).configured).toBe(false);
  });

  it("fails cleanly when the API key is missing, without ever calling fetch", async () => {
    delete process.env.CURSOR_API_KEY;
    global.fetch = vi.fn();
    const provider = createCursorProvider(makeConfig());

    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/CURSOR_API_KEY/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails cleanly when context.repos is missing, without ever calling fetch", async () => {
    global.fetch = vi.fn();
    const provider = createCursorProvider(makeConfig());

    const result = await provider.execute(makeTask({ context: {} }));

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/repos/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("starts a real agent with Basic auth and the repo from context, encoding agentId:runId as the execution id", async () => {
    global.fetch = vi.fn(async (url, init) => {
      expect(url).toBe("https://api.cursor.com/v1/agents");
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("test-key:").toString("base64")}`);
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.repos).toEqual([{ url: "https://github.com/acme/widgets" }]);
      expect(body.prompt.text).toBe("Add a README badge");
      return jsonResponse({
        agent: { id: "bc-1", url: "https://cursor.com/agents/bc-1" },
        run: { id: "run-1", agentId: "bc-1", status: "CREATING", createdAt: "now", updatedAt: "now" },
      });
    }) as unknown as typeof fetch;

    const provider = createCursorProvider(makeConfig());
    const execution = await provider.startTask(makeTask());

    expect(execution.executionId).toBe("bc-1:run-1");
    expect(execution.status).toBe("pending");
  });

  it("execute() polls until the run finishes, then returns a completed result with the PR url as evidence", async () => {
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call += 1;
      if (String(url).endsWith("/v1/agents")) {
        return jsonResponse({
          agent: { id: "bc-1", url: "https://cursor.com/agents/bc-1" },
          run: { id: "run-1", agentId: "bc-1", status: "CREATING", createdAt: "now", updatedAt: "now" },
        });
      }
      // First status poll: still running. Second: finished.
      if (call === 2) {
        return jsonResponse({ id: "run-1", agentId: "bc-1", status: "RUNNING" });
      }
      return jsonResponse({
        id: "run-1",
        agentId: "bc-1",
        status: "FINISHED",
        durationMs: 45000,
        result: "Added the badge and opened a PR.",
        git: { branches: [{ repoUrl: "github.com/acme/widgets", branch: "cursor/badge", prUrl: "https://github.com/acme/widgets/pull/9" }] },
      });
    }) as unknown as typeof fetch;

    const provider = createCursorProvider(makeConfig());
    const resultPromise = provider.execute(makeTask());
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe("completed");
    expect(result.data.prUrls).toEqual(["https://github.com/acme/widgets/pull/9"]);
    expect(result.evidence[0].url).toBe("https://github.com/acme/widgets/pull/9");
    expect(result.duration_seconds).toBe(45);
  });

  it("execute() returns a failed result (not a throw) when the run ends in ERROR", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/agents")) {
        return jsonResponse({
          agent: { id: "bc-2", url: "https://cursor.com/agents/bc-2" },
          run: { id: "run-2", agentId: "bc-2", status: "CREATING", createdAt: "now", updatedAt: "now" },
        });
      }
      return jsonResponse({ id: "run-2", agentId: "bc-2", status: "ERROR" });
    }) as unknown as typeof fetch;

    const provider = createCursorProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/ERROR/);
  });

  it("getStatus maps every Cursor run status to the app's PersistentExecutionStatus", async () => {
    const provider = createCursorProvider(makeConfig());
    const cases: Array<[string, string]> = [
      ["CREATING", "pending"],
      ["RUNNING", "running"],
      ["FINISHED", "completed"],
      ["CANCELLED", "cancelled"],
      ["ERROR", "failed"],
      ["EXPIRED", "failed"],
    ];
    for (const [cursorStatus, expected] of cases) {
      global.fetch = vi.fn(async () => jsonResponse({ id: "run-1", agentId: "bc-1", status: cursorStatus })) as unknown as typeof fetch;
      const execution = await provider.getStatus("bc-1:run-1");
      expect(execution.status).toBe(expected);
    }
  });

  it("resumeTask throws while the run is still in flight, and returns the result once finished", async () => {
    const provider = createCursorProvider(makeConfig());

    global.fetch = vi.fn(async () => jsonResponse({ id: "run-1", agentId: "bc-1", status: "RUNNING" })) as unknown as typeof fetch;
    await expect(provider.resumeTask!("bc-1:run-1")).rejects.toThrow(/has not finished yet/);

    global.fetch = vi.fn(async () =>
      jsonResponse({ id: "run-1", agentId: "bc-1", status: "FINISHED", durationMs: 1000, result: "done" })
    ) as unknown as typeof fetch;
    const result = await provider.resumeTask!("bc-1:run-1");
    expect(result.status).toBe("completed");
  });

  it("cancelTask calls the real cancel endpoint for the decoded agent/run ids", async () => {
    global.fetch = vi.fn(async (url, init) => {
      expect(url).toBe("https://api.cursor.com/v1/agents/bc-1/runs/run-1/cancel");
      expect(init?.method).toBe("POST");
      return jsonResponse({ id: "run-1" });
    }) as unknown as typeof fetch;

    const provider = createCursorProvider(makeConfig());
    await provider.cancelTask!("bc-1:run-1");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("healthCheck is false when not configured, and calls /v1/me for real when it is", async () => {
    const unconfigured = createCursorProvider(makeConfig({ cursorConfigured: false }));
    expect(await unconfigured.healthCheck()).toBe(false);

    global.fetch = vi.fn(async (url) => {
      expect(url).toBe("https://api.cursor.com/v1/me");
      return jsonResponse({ apiKeyName: "Task Dropoff", userId: 1 });
    }) as unknown as typeof fetch;
    const configured = createCursorProvider(makeConfig({ cursorConfigured: true }));
    expect(await configured.healthCheck()).toBe(true);
  });
});
