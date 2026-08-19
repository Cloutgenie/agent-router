import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApolloProvider } from "@/lib/providers/adapters/apolloProvider";
import { RuntimeConfig } from "@/lib/config";
import { ProviderTask } from "@/types";

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    mode: "live",
    explorationRate: 0.1,
    apolloConfigured: true,
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
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProviderTask> = {}): ProviderTask {
  return {
    taskId: "t1",
    traceId: "trace-1",
    stepId: "step-1",
    capability: "contact-enrichment",
    goal: "find the security decision maker",
    context: { companies: [{ name: "Acme Security", website: "acmesecurity.example" }] },
    resultCount: 5,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("ApolloProvider", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.APOLLO_API_KEY;

  beforeEach(() => {
    process.env.APOLLO_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.APOLLO_API_KEY = originalKey;
  });

  it("fails cleanly when the API key is missing, without ever calling fetch", async () => {
    delete process.env.APOLLO_API_KEY;
    global.fetch = vi.fn();
    const provider = createApolloProvider(makeConfig());

    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/APOLLO_API_KEY/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the role from search alone when deepEnrichment is not set - never reveals contact details", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.q_organization_domains_list).toEqual(["acmesecurity.example"]);
      return jsonResponse({ people: [{ id: "person-1", title: "Head of Security", organization: { name: "Acme Security" } }] });
    }) as unknown as typeof fetch;

    const provider = createApolloProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("completed");
    const byCompany = result.data.byCompany as Record<string, { decisionMakerRole: string; contact?: unknown }>;
    expect(byCompany["Acme Security"].decisionMakerRole).toBe("Head of Security");
    expect(byCompany["Acme Security"].contact).toBeUndefined(); // no reveal call made
    expect(global.fetch).toHaveBeenCalledTimes(1); // search only, no people/match call
  });

  it("reveals full contact details only when deepEnrichment is set, using the search result's id", async () => {
    global.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (String(url).includes("api_search")) {
        return jsonResponse({ people: [{ id: "person-1", title: "Head of Security" }] });
      }
      expect(body.id).toBe("person-1");
      return jsonResponse({
        person: { id: "person-1", name: "Jordan Reyes", title: "Head of Security", email: "jordan@acmesecurity.example", email_status: "verified", linkedin_url: "https://linkedin.com/in/jordanreyes" },
      });
    }) as unknown as typeof fetch;

    const provider = createApolloProvider(makeConfig());
    const result = await provider.execute(makeTask({ context: { companies: [{ name: "Acme Security", website: "acmesecurity.example" }], deepEnrichment: true } }));

    expect(result.status).toBe("completed");
    const byCompany = result.data.byCompany as Record<string, { contact?: { fullName?: string; email?: string; verificationStatus: string } }>;
    const contact = byCompany["Acme Security"].contact!;
    expect(contact.fullName).toBe("Jordan Reyes");
    expect(contact.email).toBe("jordan@acmesecurity.example");
    expect(contact.verificationStatus).toBe("verified");
  });

  it("never fabricates an email when Apollo doesn't return one", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("api_search")) {
        return jsonResponse({ people: [{ id: "person-1", title: "VP Security" }] });
      }
      return jsonResponse({ person: { id: "person-1", name: "Sam Okafor", title: "VP Security" } }); // no email field at all
    }) as unknown as typeof fetch;

    const provider = createApolloProvider(makeConfig());
    const result = await provider.execute(makeTask({ context: { companies: [{ name: "Acme Security", website: "acmesecurity.example" }], deepEnrichment: true } }));

    const byCompany = result.data.byCompany as Record<string, { contact?: { email?: string; verificationStatus: string } }>;
    const contact = byCompany["Acme Security"].contact!;
    expect(contact.email).toBeUndefined();
    expect(contact.verificationStatus).toBe("not-found");
  });

  it("skips a company entirely rather than inventing a decision maker when Apollo finds no match", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ people: [] })) as unknown as typeof fetch;

    const provider = createApolloProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("completed");
    expect(result.data.byCompany).toEqual({});
  });

  it("fails cleanly (not a thrown exception) when Apollo returns an error status", async () => {
    global.fetch = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    const provider = createApolloProvider(makeConfig());
    const result = await provider.execute(makeTask());

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/429/);
  });
});
