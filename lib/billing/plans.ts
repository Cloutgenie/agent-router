import { BillingPlan, PlanDefinition } from "@/types";

/**
 * Data-driven plan configuration (spec #4) - React components read this
 * table rather than hard-coding prices/limits inline. Values match the
 * spec's stated plans exactly; Enterprise is deliberately not automated
 * (`contactSalesOnly`) since the spec explicitly says not to price it.
 */
export const PLAN_DEFINITIONS: Record<BillingPlan, PlanDefinition> = {
  free: {
    plan: "free",
    name: "Free",
    priceCents: 0,
    entitlements: {
      maxUsers: 1,
      includedExecutionCents: 0,
      browserExecution: false,
      apolloEnrichment: false,
      benchmarks: false,
      apiAccess: false,
      mcp: false,
      maxConcurrency: 1,
    },
  },
  starter: {
    plan: "starter",
    name: "Starter",
    priceCents: 4900,
    entitlements: {
      maxUsers: 1,
      includedExecutionCents: 1000,
      browserExecution: false,
      apolloEnrichment: false,
      benchmarks: false,
      apiAccess: false,
      mcp: false,
      maxConcurrency: 2,
    },
  },
  pro: {
    plan: "pro",
    name: "Pro",
    priceCents: 14900,
    entitlements: {
      maxUsers: 3,
      includedExecutionCents: 4000,
      browserExecution: true,
      apolloEnrichment: true,
      benchmarks: true,
      apiAccess: true,
      mcp: false,
      maxConcurrency: 5,
    },
  },
  business: {
    plan: "business",
    name: "Business",
    priceCents: 49900,
    entitlements: {
      maxUsers: 10,
      includedExecutionCents: 15000,
      browserExecution: true,
      apolloEnrichment: true,
      benchmarks: true,
      apiAccess: true,
      mcp: true,
      maxConcurrency: 15,
    },
  },
  enterprise: {
    plan: "enterprise",
    name: "Enterprise",
    priceCents: 0,
    contactSalesOnly: true,
    entitlements: {
      maxUsers: Infinity,
      includedExecutionCents: Infinity,
      browserExecution: true,
      apolloEnrichment: true,
      benchmarks: true,
      apiAccess: true,
      mcp: true,
      maxConcurrency: 50,
    },
  },
};

export function planDefinition(plan: BillingPlan): PlanDefinition {
  return PLAN_DEFINITIONS[plan];
}
