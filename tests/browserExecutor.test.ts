import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeConfig } from "@/lib/config";
import { ProviderTask } from "@/types";

const connectMock = vi.fn();
vi.mock("puppeteer-core", () => ({
  default: { connect: (...args: unknown[]) => connectMock(...args) },
}));

const { createBrowserExecutor } = await import("@/lib/providers/adapters/browserExecutor");

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
    browserExecutionConfigured: true,
    browserbaseConfigured: false,
    maxBrowserPagesPerTask: 10,
    persistentAgentConfigured: false,
    cursorConfigured: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProviderTask> = {}): ProviderTask {
  return {
    taskId: "t1",
    traceId: "trace-1",
    stepId: "step-1",
    capability: "official-source-verification",
    goal: "verify hiring signal",
    context: {
      companies: [{ name: "Acme Co", website: "acme.example" }],
      hiringByCompany: { "Acme Co": { evidence: [] } }, // empty evidence -> always escalates
    },
    resultCount: 5,
    ...overrides,
  };
}

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

describe("BrowserExecutor", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    connectMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fails cleanly when browser execution is disabled, without touching fetch or puppeteer", async () => {
    global.fetch = vi.fn();
    const provider = createBrowserExecutor(makeConfig({ browserExecutionConfigured: false }));

    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("uses the static-fetch path (never touches puppeteer) when Browserbase isn't configured", async () => {
    global.fetch = vi.fn(async () => htmlResponse("<title>Acme Careers</title><body>We're hiring! Open roles now.</body>")) as unknown as typeof fetch;
    const provider = createBrowserExecutor(makeConfig({ browserbaseConfigured: false }));

    const result = await provider.execute(makeTask());

    expect(result.status).toBe("completed");
    const byCompany = result.data.byCompany as Record<string, { hiringPageConfirmed: boolean }>;
    expect(byCompany["Acme Co"].hiringPageConfirmed).toBe(true);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("drives a real Browserbase session via puppeteer-core when configured, and always releases it", async () => {
    const fetchCalls: string[] = [];
    global.fetch = vi.fn(async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes("/v1/sessions") && !String(url).match(/sessions\/.+/)) {
        return new Response(JSON.stringify({ id: "sess-1", connectUrl: "wss://fake" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "sess-1", status: "COMPLETED" }), { status: 200 });
    }) as unknown as typeof fetch;

    const page = {
      goto: vi.fn(async () => ({ ok: () => true })),
      title: vi.fn(async () => "Acme Careers"),
      evaluate: vi.fn(async () => "We're hiring! Open roles now."),
    };
    const browser = { newPage: vi.fn(async () => page), disconnect: vi.fn(async () => undefined) };
    connectMock.mockResolvedValue(browser);

    const provider = createBrowserExecutor(makeConfig({ browserbaseConfigured: true }));
    const result = await provider.execute(
      makeTask({
        context: {
          companies: [{ name: "Acme Co", website: "acme.example" }],
          hiringByCompany: { "Acme Co": { evidence: [] } },
        },
      })
    );

    expect(result.status).toBe("completed");
    expect(connectMock).toHaveBeenCalledWith({ browserWSEndpoint: "wss://fake" });
    const byCompany = result.data.byCompany as Record<string, { hiringPageConfirmed: boolean }>;
    expect(byCompany["Acme Co"].hiringPageConfirmed).toBe(true);
    expect(browser.disconnect).toHaveBeenCalled();
    expect(fetchCalls.some((u) => u.includes("/v1/sessions/sess-1"))).toBe(true); // release call made
  });

  it("still releases the Browserbase session when every candidate page fails to load", async () => {
    const fetchCalls: string[] = [];
    global.fetch = vi.fn(async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes("/v1/sessions") && !String(url).match(/sessions\/.+/)) {
        return new Response(JSON.stringify({ id: "sess-2", connectUrl: "wss://fake" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "sess-2", status: "COMPLETED" }), { status: 200 });
    }) as unknown as typeof fetch;

    const page = { goto: vi.fn(async () => { throw new Error("net::ERR_NAME_NOT_RESOLVED"); }) };
    const browser = { newPage: vi.fn(async () => page), disconnect: vi.fn(async () => undefined) };
    connectMock.mockResolvedValue(browser);

    const provider = createBrowserExecutor(makeConfig({ browserbaseConfigured: true }));
    const result = await provider.execute(
      makeTask({
        context: {
          companies: [{ name: "Acme Co", website: "acme.example" }],
          hiringByCompany: { "Acme Co": { evidence: [] } },
        },
      })
    );

    expect(result.status).toBe("completed");
    expect(result.data.byCompany).toEqual({}); // no page reachable - never invent a result
    expect(fetchCalls.some((u) => u.includes("/v1/sessions/sess-2"))).toBe(true); // release call made
    expect(browser.disconnect).toHaveBeenCalled();
  });

  it("keeps evidence from earlier companies when a later company's session creation is rate-limited", async () => {
    let sessionCreateCalls = 0;
    global.fetch = vi.fn(async (url) => {
      const isCreate = String(url).includes("/v1/sessions") && !String(url).match(/sessions\/.+/);
      if (isCreate) {
        sessionCreateCalls += 1;
        if (sessionCreateCalls === 2) {
          return new Response(JSON.stringify({ error: "Too Many Requests", statusCode: 429 }), { status: 429 });
        }
        return new Response(JSON.stringify({ id: `sess-${sessionCreateCalls}`, connectUrl: "wss://fake" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
    }) as unknown as typeof fetch;

    const page = {
      goto: vi.fn(async () => ({ ok: () => true })),
      title: vi.fn(async () => "Careers"),
      evaluate: vi.fn(async () => "We're hiring! Open roles now."),
    };
    const browser = { newPage: vi.fn(async () => page), disconnect: vi.fn(async () => undefined) };
    connectMock.mockResolvedValue(browser);

    const provider = createBrowserExecutor(makeConfig({ browserbaseConfigured: true }));
    const result = await provider.execute(
      makeTask({
        context: {
          companies: [
            { name: "First Co", website: "first.example" },
            { name: "Second Co", website: "second.example" }, // hits the simulated 429
            { name: "Third Co", website: "third.example" },
          ],
          hiringByCompany: {
            "First Co": { evidence: [] },
            "Second Co": { evidence: [] },
            "Third Co": { evidence: [] },
          },
        },
      })
    );

    expect(result.status).toBe("completed");
    const byCompany = result.data.byCompany as Record<string, unknown>;
    expect(byCompany["First Co"]).toBeDefined();
    expect(byCompany["Second Co"]).toBeUndefined(); // rate-limited - skipped, not fabricated
    expect(byCompany["Third Co"]).toBeDefined(); // one company's failure didn't kill the rest
  });
});
