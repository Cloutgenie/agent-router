import { BillingPlan, PlanEntitlements } from "@/types";
import { planDefinition } from "./plans";

export type EntitlementFeature = "browser_execution" | "apollo_enrichment" | "benchmarks" | "api_access" | "mcp";

const FEATURE_FIELD: Record<EntitlementFeature, keyof PlanEntitlements> = {
  browser_execution: "browserExecution",
  apollo_enrichment: "apolloEnrichment",
  benchmarks: "benchmarks",
  api_access: "apiAccess",
  mcp: "mcp",
};

export interface Entitlements {
  plan: BillingPlan;
  raw: PlanEntitlements;
  /** `entitlements.can("browser_execution")` - the one place feature gating should be checked, never a scattered `if (plan === "pro")`. */
  can(feature: EntitlementFeature): boolean;
}

export function getEntitlements(plan: BillingPlan): Entitlements {
  const raw = planDefinition(plan).entitlements;
  return {
    plan,
    raw,
    can(feature) {
      return Boolean(raw[FEATURE_FIELD[feature]]);
    },
  };
}

/**
 * Which real provider ids require which plan feature (spec #23's
 * entitlements-gate-router-eligibility instruction). Deliberately a small,
 * explicit map rather than deriving it from capabilities - most providers
 * (Tavily, the LLM adapters, every mock) require nothing; only the ones
 * here are gated. Keyed by the adapter's own `AgentProvider.id` string, so
 * renaming a provider id must update this map too.
 */
const PROVIDER_FEATURE_REQUIREMENT: Record<string, EntitlementFeature> = {
  "apollo-provider": "apollo_enrichment",
  "browser-executor": "browser_execution",
  "mcp-provider": "mcp",
};

/** Whether a specific provider is allowed under a plan's entitlements - true for every provider not in the gated set above. */
export function isProviderEntitled(providerId: string, entitlements: Entitlements): boolean {
  const required = PROVIDER_FEATURE_REQUIREMENT[providerId];
  return required == null || entitlements.can(required);
}
