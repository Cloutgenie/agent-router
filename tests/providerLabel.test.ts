import { describe, expect, it } from "vitest";
import { actualProviderName } from "@/lib/providerLabel";
import { ExecutionStep } from "@/types";

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-1",
    capability: "company-research",
    description: "Discover companies",
    dependencies: [],
    candidates: [],
    fallbackProviderIds: [],
    usedFallback: false,
    status: "completed",
    ...overrides,
  };
}

describe("actualProviderName", () => {
  it("returns undefined when nothing was ever selected", () => {
    expect(actualProviderName(step())).toBeUndefined();
  });

  it("resolves the primary candidate's name when no fallback occurred", () => {
    const s = step({
      selectedProviderId: "tavily",
      candidates: [{ provider_id: "tavily", provider_name: "Tavily" } as ExecutionStep["candidates"][number]],
    });
    expect(actualProviderName(s)).toBe("Tavily");
  });

  it("resolves the fallback provider's name, not the originally-scored primary's - the regression this guards against", () => {
    // Routing scored Apollo highest (selected: true), but it failed and the
    // engine fell back to Tavily, which actually completed the step -
    // selectedProviderId is reassigned to "tavily" (see
    // lib/execution/stepEngine.ts::runStepWithFallback), while candidates[]
    // still shows Apollo as "selected" because that flag is frozen at
    // routing time. The label must follow selectedProviderId, not the
    // stale flag, or a successful fallback gets attributed to the provider
    // that actually failed.
    const s = step({
      usedFallback: true,
      selectedProviderId: "tavily",
      candidates: [
        { provider_id: "apollo-provider", provider_name: "Apollo", selected: true } as ExecutionStep["candidates"][number],
        { provider_id: "tavily", provider_name: "Tavily", selected: false } as ExecutionStep["candidates"][number],
      ],
    });
    expect(actualProviderName(s)).toBe("Tavily");
    expect(actualProviderName(s)).not.toBe("Apollo");
  });

  it("falls back to the raw provider id if it isn't in the candidate list for some reason", () => {
    const s = step({ selectedProviderId: "mystery-provider", candidates: [] });
    expect(actualProviderName(s)).toBe("mystery-provider");
  });
});
