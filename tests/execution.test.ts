import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "@/lib/config";
import type { ExecutionStep } from "@/types";
import { alwaysFailProvider, alwaysSucceedProvider } from "./fixtures";

vi.mock("@/lib/history/performanceStore", () => ({
  recordProviderAttempt: vi.fn(async () => undefined),
  getAllPerformanceMetrics: vi.fn(async () => []),
}));

vi.mock("@/lib/market/quoteStore", () => ({
  recordQuotes: vi.fn(async () => undefined),
}));

const failing = alwaysFailProvider("failing-provider");
const backup = alwaysSucceedProvider("backup-provider");

vi.mock("@/lib/providers/registry", () => ({
  getEligibleProviders: vi.fn(() => [failing, backup]),
  getProviderById: vi.fn((id: string) => [failing, backup].find((p) => p.id === id)),
}));

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

describe("executeStepGraph", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // no exploration
  });

  it("falls back to the next candidate provider when the primary fails", async () => {
    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("step-a")];
    const config = getRuntimeConfig();

    const events = [];
    for await (const event of executeStepGraph({
      taskId: "t1",
      traceId: "trace-1",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config,
    })) {
      events.push(event);
    }

    const step = steps[0];
    expect(step.status).toBe("completed");
    expect(step.usedFallback).toBe(true);
    expect(step.selectedProviderId).toBe("backup-provider");
    expect(events.some((e) => e.event === "fallback")).toBe(true);
  });

  it("marks a step failed only once every candidate has failed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [failing]),
      getProviderById: vi.fn(() => failing),
    }));
    vi.doMock("@/lib/history/performanceStore", () => ({
      recordProviderAttempt: vi.fn(async () => undefined),
      getAllPerformanceMetrics: vi.fn(async () => []),
    }));

    const { executeStepGraph: executeAllFail } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("step-b")];
    const config = getRuntimeConfig();

    for await (const _event of executeAllFail({
      taskId: "t2",
      traceId: "trace-2",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config,
    })) {
      void _event;
    }

    expect(steps[0].status).toBe("failed");
  });
});

describe("executeStepGraph approval gating", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    // A prior test in this file overrides the registry mock via vi.doMock -
    // that override outlives it, so restore the full [failing, backup] pool
    // before every test here regardless of run order.
    vi.resetModules();
    vi.doMock("@/lib/providers/registry", () => ({
      getEligibleProviders: vi.fn(() => [failing, backup]),
      getProviderById: vi.fn((id: string) => [failing, backup].find((p) => p.id === id)),
    }));
    vi.doMock("@/lib/history/performanceStore", () => ({
      recordProviderAttempt: vi.fn(async () => undefined),
      getAllPerformanceMetrics: vi.fn(async () => []),
    }));
  });

  it("blocks an un-pre-approved write-capable step before it ever reaches a provider", async () => {
    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("send-email", "email-send")];
    const config = getRuntimeConfig();

    const events = [];
    for await (const event of executeStepGraph({
      taskId: "t3",
      traceId: "trace-3",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config,
    })) {
      events.push(event);
    }

    const step = steps[0];
    expect(step.status).toBe("awaiting_approval");
    expect(step.approval?.status).toBe("pending");
    expect(step.selectedProviderId).toBeUndefined();
    expect(step.candidates).toHaveLength(0);
    expect(events.some((e) => e.event === "blocked")).toBe(true);
    expect(events.some((e) => e.event === "started" || e.event === "completed")).toBe(false);
  });

  it("routes and executes a write-capable step once its capability is pre-approved", async () => {
    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("send-email", "email-send")];
    const config = getRuntimeConfig();

    const events = [];
    for await (const event of executeStepGraph({
      taskId: "t4",
      traceId: "trace-4",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: { approved_actions: ["email-send"] },
      config,
    })) {
      events.push(event);
    }

    const step = steps[0];
    expect(step.approval?.status).toBe("approved");
    expect(step.status).toBe("completed");
    expect(events.some((e) => e.event === "blocked")).toBe(false);
  });

  it("never blocks a read-only step, regardless of pre-approval", async () => {
    const { executeStepGraph } = await import("@/lib/execution/stepEngine");
    const steps = [emptyStep("discover", "company-research")];
    const config = getRuntimeConfig();

    for await (const _event of executeStepGraph({
      taskId: "t5",
      traceId: "trace-5",
      rawTask: "test",
      steps,
      resultCount: 5,
      mode: "demo",
      constraints: {},
      config,
    })) {
      void _event;
    }

    expect(steps[0].approval).toEqual({ required: false, status: "not_required" });
    expect(steps[0].status).toBe("completed");
  });
});
