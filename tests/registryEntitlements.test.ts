import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntimeConfig } from "@/lib/config";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getEligibleProviders } from "@/lib/providers/registry";

describe("getEligibleProviders with entitlements", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ENABLE_LIVE_PROVIDERS: "true", APOLLO_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("excludes a real gated provider from live-mode eligibility when the plan lacks the feature", () => {
    const config = getRuntimeConfig();
    expect(config.apolloConfigured).toBe(true); // sanity check - Apollo really is configured here

    const withoutFeature = getEligibleProviders("contact-enrichment", "live", config, {}, getEntitlements("starter"));
    expect(withoutFeature.some((p) => p.id === "apollo-provider")).toBe(false);
    // The mock fallback stays eligible - entitlements degrade to it rather than leaving the step with nothing.
    expect(withoutFeature.some((p) => p.id === "contact-miner")).toBe(true);

    const withFeature = getEligibleProviders("contact-enrichment", "live", config, {}, getEntitlements("pro"));
    expect(withFeature.some((p) => p.id === "apollo-provider")).toBe(true);
  });

  it("leaves eligibility completely unchanged when no entitlements are passed", () => {
    const config = getRuntimeConfig();
    const withEntitlements = getEligibleProviders("contact-enrichment", "live", config, {}, getEntitlements("pro"));
    const withoutEntitlements = getEligibleProviders("contact-enrichment", "live", config, {});
    // Pro already includes apollo_enrichment, so both should agree here - the real point is that
    // omitting entitlements never THROWS and never excludes anything on its own.
    expect(withoutEntitlements.map((p) => p.id).sort()).toEqual(withEntitlements.map((p) => p.id).sort());
  });
});
