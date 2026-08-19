import { describe, expect, it } from "vitest";
import { evaluateAutoSafetySignal } from "@/lib/policy/autoSafety";
import { ProviderPerformanceRecord } from "@/types";

function record(overrides: Partial<ProviderPerformanceRecord> = {}): ProviderPerformanceRecord {
  return {
    provider_id: "p1",
    capability: "web-research",
    tasks_attempted: 0,
    success_count: 0,
    confidence_sum: 0,
    latency_sum: 0,
    cost_sum: 0,
    verification_pass_count: 0,
    verification_total: 0,
    accepted_count: 0,
    rejected_count: 0,
    recent_attempts: [],
    recent_verifications: [],
    ...overrides,
  };
}

describe("evaluateAutoSafetySignal", () => {
  it("does nothing below the minimum sample size, no matter how bad the rate looks", () => {
    const r = record({ tasks_attempted: 4, success_count: 0 }); // 100% failure, but only 4 attempts
    expect(evaluateAutoSafetySignal(r).action).toBe("none");
  });

  it("degrades once the failure rate crosses 50% with enough samples", () => {
    const r = record({ tasks_attempted: 10, success_count: 4 }); // 60% failure
    const decision = evaluateAutoSafetySignal(r);
    expect(decision.action).toBe("degrade");
    expect(decision.reason).toMatch(/60%/);
  });

  it("disables once the failure rate crosses 85%", () => {
    const r = record({ tasks_attempted: 10, success_count: 1 }); // 90% failure
    const decision = evaluateAutoSafetySignal(r);
    expect(decision.action).toBe("disable");
  });

  it("stays healthy when the failure rate is below the degrade threshold", () => {
    const r = record({ tasks_attempted: 10, success_count: 8 }); // 20% failure
    expect(evaluateAutoSafetySignal(r).action).toBe("none");
  });

  it("degrades on a verification/unsupported-claims spike even with a good raw success rate", () => {
    const r = record({
      tasks_attempted: 10,
      success_count: 10,
      verification_total: 8,
      verification_pass_count: 2, // 75% unsupported
    });
    const decision = evaluateAutoSafetySignal(r);
    expect(decision.action).toBe("degrade");
    expect(decision.reason).toMatch(/verification/);
  });

  it("degrades when average cost is well above a configured ceiling", () => {
    const r = record({ tasks_attempted: 6, success_count: 6, cost_sum: 30 }); // avg $5/task
    expect(evaluateAutoSafetySignal(r, 2).action).toBe("degrade");
    expect(evaluateAutoSafetySignal(r, 10).action).toBe("none"); // well within a generous ceiling
  });

  it("ignores cost entirely when no ceiling is configured", () => {
    const r = record({ tasks_attempted: 6, success_count: 6, cost_sum: 1000 });
    expect(evaluateAutoSafetySignal(r, undefined).action).toBe("none");
  });
});
