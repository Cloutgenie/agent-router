import { describe, expect, it } from "vitest";
import { getEntitlements, isProviderEntitled } from "@/lib/billing/entitlements";
import { PLAN_DEFINITIONS } from "@/lib/billing/plans";

describe("getEntitlements", () => {
  it("gates features through can(), never a scattered plan === check", () => {
    expect(getEntitlements("free").can("browser_execution")).toBe(false);
    expect(getEntitlements("starter").can("browser_execution")).toBe(false);
    expect(getEntitlements("pro").can("browser_execution")).toBe(true);
    expect(getEntitlements("pro").can("apollo_enrichment")).toBe(true);
    expect(getEntitlements("pro").can("mcp")).toBe(false);
    expect(getEntitlements("business").can("mcp")).toBe(true);
  });

  it("gives every plan an included execution allowance matching the spec's stated dollar amounts", () => {
    expect(PLAN_DEFINITIONS.starter.entitlements.includedExecutionCents).toBe(1000);
    expect(PLAN_DEFINITIONS.pro.entitlements.includedExecutionCents).toBe(4000);
    expect(PLAN_DEFINITIONS.business.entitlements.includedExecutionCents).toBe(15000);
  });

  it("never automates enterprise pricing", () => {
    expect(PLAN_DEFINITIONS.enterprise.contactSalesOnly).toBe(true);
  });
});

describe("isProviderEntitled", () => {
  it("excludes Apollo, the real browser executor, and MCP for a plan without those features", () => {
    const starter = getEntitlements("starter");
    expect(isProviderEntitled("apollo-provider", starter)).toBe(false);
    expect(isProviderEntitled("browser-executor", starter)).toBe(false);
    expect(isProviderEntitled("mcp-provider", starter)).toBe(false);
  });

  it("allows them once the plan includes the feature", () => {
    const pro = getEntitlements("pro"); // apollo_enrichment + browser_execution, not mcp
    expect(isProviderEntitled("apollo-provider", pro)).toBe(true);
    expect(isProviderEntitled("browser-executor", pro)).toBe(true);
    expect(isProviderEntitled("mcp-provider", pro)).toBe(false);

    const business = getEntitlements("business"); // has mcp too
    expect(isProviderEntitled("mcp-provider", business)).toBe(true);
  });

  it("never restricts a provider that isn't in the gated set - every mock, Tavily, the LLM adapters, etc.", () => {
    const free = getEntitlements("free");
    expect(isProviderEntitled("research-agent", free)).toBe(true);
    expect(isProviderEntitled("tavily", free)).toBe(true);
    expect(isProviderEntitled("openai-analysis-provider", free)).toBe(true);
  });
});
