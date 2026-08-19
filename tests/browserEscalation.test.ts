import { describe, expect, it } from "vitest";
import { needsBrowserEscalation } from "@/lib/providers/browserEscalation";
import { Evidence } from "@/types";

function evidence(confidence: number, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: `ev-${Math.random()}`,
    type: "job_posting",
    title: "Open roles",
    source: "example.com/careers",
    sourceQuality: "medium",
    confidence,
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("needsBrowserEscalation", () => {
  it("escalates when there is no upstream hiring evidence at all", () => {
    expect(needsBrowserEscalation({})).toBe(true);
    expect(needsBrowserEscalation({ evidence: [] })).toBe(true);
  });

  it("escalates when the average upstream confidence is weak", () => {
    expect(needsBrowserEscalation({ evidence: [evidence(0.59)] })).toBe(true);
    expect(needsBrowserEscalation({ evidence: [evidence(0.5), evidence(0.6)] })).toBe(true);
  });

  it("does not escalate when the upstream hiring signal is already strong", () => {
    expect(needsBrowserEscalation({ evidence: [evidence(0.9)] })).toBe(false);
    expect(needsBrowserEscalation({ evidence: [evidence(0.8), evidence(0.85)] })).toBe(false);
  });

  it("sits exactly on the documented 0.75 confidence threshold", () => {
    expect(needsBrowserEscalation({ evidence: [evidence(0.75)] })).toBe(false);
    expect(needsBrowserEscalation({ evidence: [evidence(0.7499)] })).toBe(true);
  });
});
