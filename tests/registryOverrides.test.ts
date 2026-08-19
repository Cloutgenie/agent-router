import { describe, expect, it } from "vitest";
import { getEligibleProviders } from "@/lib/providers/registry";
import { getRuntimeConfig } from "@/lib/config";
import { ProviderOverride } from "@/types";

function override(overrides: Partial<ProviderOverride> = {}): ProviderOverride {
  return { enabled: true, degraded: false, updatedAt: new Date().toISOString(), updatedBy: "manual", ...overrides };
}

describe("getEligibleProviders with overrides", () => {
  const config = getRuntimeConfig(); // demo mode by default in tests (no ENABLE_LIVE_PROVIDERS)

  it("excludes a provider whose kill switch is off, in every mode", () => {
    const withoutOverride = getEligibleProviders("company-research", "demo", config, {});
    expect(withoutOverride.some((p) => p.id === "research-agent")).toBe(true);

    const withKillSwitch = getEligibleProviders("company-research", "demo", config, {
      "research-agent": override({ enabled: false }),
    });
    expect(withKillSwitch.some((p) => p.id === "research-agent")).toBe(false);
  });

  it("excludes a provider whose price exceeds its configured cost ceiling", () => {
    // Funding Intelligence is $1.50/task in the seeded mocks.
    const withCap = getEligibleProviders("funding-research", "demo", config, {
      "funding-intelligence": override({ maxCostPerTask: 1 }),
    });
    expect(withCap.some((p) => p.id === "funding-intelligence")).toBe(false);

    const withRoomyCap = getEligibleProviders("funding-research", "demo", config, {
      "funding-intelligence": override({ maxCostPerTask: 5 }),
    });
    expect(withRoomyCap.some((p) => p.id === "funding-intelligence")).toBe(true);
  });

  it("keeps a degraded provider eligible but with heavily reduced scores", () => {
    const baseline = getEligibleProviders("company-research", "demo", config, {});
    const baselineAgent = baseline.find((p) => p.id === "research-agent")!;

    const degraded = getEligibleProviders("company-research", "demo", config, {
      "research-agent": override({ degraded: true }),
    });
    const degradedAgent = degraded.find((p) => p.id === "research-agent");

    expect(degradedAgent).toBeDefined();
    expect(degradedAgent!.quality_score).toBeLessThan(baselineAgent.quality_score);
    expect(degradedAgent!.reliability_score).toBeLessThan(baselineAgent.reliability_score);
  });

  it("leaves an un-overridden provider completely unaffected", () => {
    const providers = getEligibleProviders("company-research", "demo", config, {
      "some-other-provider": override({ enabled: false }),
    });
    expect(providers.some((p) => p.id === "research-agent")).toBe(true);
  });
});
