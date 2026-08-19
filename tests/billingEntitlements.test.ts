import { describe, expect, it } from "vitest";
import { getEntitlements } from "@/lib/billing/entitlements";
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
