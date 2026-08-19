import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "@/lib/config";
import type { ExecutionStep, ProviderOverride, ProviderResult } from "@/types";
import { alwaysSucceedProvider, makeProvider } from "./fixtures";

function emptyStep(id: string, capability: ExecutionStep["capability"] = "company-research"): ExecutionStep {
  return {
    id,
    capability,
    description: id,
    dependencies: [],
    candidates: [],
    fallbackProviderIds: [],
    usedFallback: false,
    status: "pending",
  };
}

function overrideOf(patch: Partial<ProviderOverride>): ProviderOverride {
  return { enabled: true, degraded: false, updatedAt: new Date().toISOString(), updatedBy: "manual", ...patch };
}

function mockPerformanceStore() {
  vi.doMock("@/lib/history/performanceStore", () => ({
    recordProviderAttempt: vi.fn(async () => undefined),
    getAllPerformanceMetrics: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/market/quoteStore", () => ({
    recordQuotes: vi.fn(async () => undefined),
  }));
}

describe("stepEngine runtime caps", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.resetModules();
  });

  it("treats a call that outlives its timeout as a failure and falls back", async () => {
    const hanging = makeProvider({
      id: "hanging-provider",
      name: "hanging-provider",
      async execute(): Promise<ProviderResult> {
        return new Promise(() => {}); // never resolves on its own
      },
    });
    const backup = alwaysSucceedProvider("timeout-backup");

    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [hanging, backup]),
      getProviderById: vi.fn((id: string) => [hanging, backup].find((p) => p.id === id)),
    }));
    vi.doMock("@/lib/providers/overrideStore", () => ({
      getCachedOverrides: vi.fn(() => ({ "hanging-provider": overrideOf({ timeoutMs: 50 }) })),
    }));
    mockPerformanceStore();

    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("step-timeout")];
    const events = [];
    for await (const event of executeStepGraph({
      taskId: "t1",
      traceId: "trace-1",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config: getRuntimeConfig(),
    })) {
      events.push(event);
    }

    expect(steps[0].status).toBe("completed");
    expect(steps[0].selectedProviderId).toBe("timeout-backup");
    expect(events.some((e) => e.event === "fallback")).toBe(true);
  }, 2000);

  it("retries the same provider up to maxRetries before giving up, with no other candidate available", async () => {
    let calls = 0;
    const flaky = makeProvider({
      id: "flaky-provider",
      name: "flaky-provider",
      async execute(): Promise<ProviderResult> {
        calls += 1;
        if (calls < 2) {
          return { status: "failed", data: {}, evidence: [], confidence: 0, cost: 0, duration_seconds: 0.01, error: "transient" };
        }
        return { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 1, duration_seconds: 0.01 };
      },
    });

    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [flaky]),
      getProviderById: vi.fn(() => flaky),
    }));
    vi.doMock("@/lib/providers/overrideStore", () => ({
      getCachedOverrides: vi.fn(() => ({ "flaky-provider": overrideOf({ maxRetries: 2 }) })),
    }));
    mockPerformanceStore();

    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("step-retry")];
    for await (const _event of executeStepGraph({
      taskId: "t2",
      traceId: "trace-2",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config: getRuntimeConfig(),
    })) {
      void _event;
    }

    expect(steps[0].status).toBe("completed");
    expect(steps[0].selectedProviderId).toBe("flaky-provider");
    expect(calls).toBe(2);
  });

  it("fails without retrying when maxRetries is unset (default 1 attempt)", async () => {
    let calls = 0;
    const flaky = makeProvider({
      id: "flaky-provider-2",
      name: "flaky-provider-2",
      async execute(): Promise<ProviderResult> {
        calls += 1;
        return { status: "failed", data: {}, evidence: [], confidence: 0, cost: 0, duration_seconds: 0.01, error: "transient" };
      },
    });

    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [flaky]),
      getProviderById: vi.fn(() => flaky),
    }));
    vi.doMock("@/lib/providers/overrideStore", () => ({ getCachedOverrides: vi.fn(() => ({})) }));
    mockPerformanceStore();

    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("step-no-retry")];
    for await (const _event of executeStepGraph({
      taskId: "t3",
      traceId: "trace-3",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config: getRuntimeConfig(),
    })) {
      void _event;
    }

    expect(steps[0].status).toBe("failed");
    expect(calls).toBe(1);
  });

  it("caps how many steps in one task can route to the same provider (maxRunsPerTask)", async () => {
    const providerA = alwaysSucceedProvider("provider-a");
    const providerB = alwaysSucceedProvider("provider-b");

    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [providerA, providerB]),
      getProviderById: vi.fn((id: string) => [providerA, providerB].find((p) => p.id === id)),
    }));
    vi.doMock("@/lib/providers/overrideStore", () => ({
      getCachedOverrides: vi.fn(() => ({ "provider-a": overrideOf({ maxRunsPerTask: 1 }) })),
    }));
    mockPerformanceStore();

    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    // Sequential (allow_parallel: false) so the two steps route one at a time, deterministically.
    const steps = [emptyStep("step-1", "company-research"), emptyStep("step-2", "web-research")];
    for await (const _event of executeStepGraph({
      taskId: "t4",
      traceId: "trace-4",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: { allow_parallel: false },
      config: getRuntimeConfig(),
    })) {
      void _event;
    }

    const selectedProviders = steps.map((s) => s.selectedProviderId);
    expect(selectedProviders).toContain("provider-a");
    expect(selectedProviders).toContain("provider-b");
    expect(selectedProviders[0]).not.toBe(selectedProviders[1]);
  });

  it("enforces maxConcurrentRuns across two tasks running at the same time, not just within one", async () => {
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const slow = makeProvider({
      id: "slow-shared-provider",
      name: "slow-shared-provider",
      async execute(): Promise<ProviderResult> {
        inFlight += 1;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        return { status: "completed", data: {}, evidence: [], confidence: 0.9, cost: 1, duration_seconds: 0.04 };
      },
    });
    const backup = alwaysSucceedProvider("concurrency-backup");

    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [slow, backup]),
      getProviderById: vi.fn((id: string) => [slow, backup].find((p) => p.id === id)),
    }));
    vi.doMock("@/lib/providers/overrideStore", () => ({
      getCachedOverrides: vi.fn(() => ({ "slow-shared-provider": overrideOf({ maxConcurrentRuns: 1 }) })),
    }));
    mockPerformanceStore();

    const { executeStepGraph } = await import("@/lib/execution/stepEngine");

    async function runOneTask(taskId: string) {
      const steps = [emptyStep(`${taskId}-step`)];
      for await (const _event of executeStepGraph({
        taskId,
        traceId: `trace-${taskId}`,
        rawTask: "test",
        steps,
        resultCount: 5,
        mode: "demo",
        constraints: {},
        config: getRuntimeConfig(),
      })) {
        void _event;
      }
      return steps[0];
    }

    // Start both "at once" - the second's routing/execution genuinely overlaps the first's in-flight call.
    const [resultA, resultB] = await Promise.all([runOneTask("task-a"), runOneTask("task-b")]);

    expect(maxObservedInFlight).toBe(1); // never more than one concurrent call to the capped provider
    const selected = [resultA.selectedProviderId, resultB.selectedProviderId];
    expect(selected).toContain("slow-shared-provider");
    expect(selected).toContain("concurrency-backup");
  });
});
