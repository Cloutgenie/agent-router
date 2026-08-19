import { ExecutionPrice } from "@/types";

/**
 * provider cost + verification cost + platform margin = customer price
 * (spec #7-8). All internal math is integer cents - inputs arrive as
 * dollars (matching the rest of the app's `price_per_task`/`cost`
 * convention) and are converted at the boundary, immediately.
 */
export interface PricingPolicy {
  /** e.g. 35 = 35% markup over provider+verification cost. */
  markupPercent: number;
  /** Floor on the customer price, regardless of how small the underlying cost was. */
  minimumFeeCents: number;
}

/**
 * Deliberately not the only permanent economic model - a config value, not
 * a hard-coded formula path (spec #8: "Do not hard-code one permanent
 * economic model"). Callers may pass their own `PricingPolicy`.
 */
export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  markupPercent: 35,
  minimumFeeCents: 25,
};

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export interface CalculateExecutionPriceInput {
  providerCostDollars: number;
  verificationCostDollars?: number;
  policy?: PricingPolicy;
}

export function calculateExecutionPrice(input: CalculateExecutionPriceInput): ExecutionPrice {
  const policy = input.policy ?? DEFAULT_PRICING_POLICY;
  const providerCostCents = dollarsToCents(input.providerCostDollars);
  const verificationCostCents = dollarsToCents(input.verificationCostDollars ?? 0);
  const baseCents = providerCostCents + verificationCostCents;
  const markupCents = Math.round(baseCents * (policy.markupPercent / 100));
  const customerPriceCents = Math.max(baseCents + markupCents, policy.minimumFeeCents);
  // The gap between customer price and raw cost, however it was produced
  // (percentage markup, or the minimum-fee floor kicking in on a tiny task).
  const platformFeeCents = customerPriceCents - baseCents;

  return {
    estimatedProviderCostCents: providerCostCents,
    verificationCostCents,
    platformFeeCents,
    estimatedCustomerPriceCents: customerPriceCents,
  };
}

export interface ExecutionPriceRange {
  lowCents: number;
  highCents: number;
}

/**
 * Pre-execution estimate range (spec #9/#25) - runs the same pricing
 * function over the cheapest and priciest plausible provider-cost totals
 * for a plan, rather than a single point estimate that inevitably reads as
 * falsely precise before any provider has actually run.
 */
export function estimateExecutionPriceRange(
  lowProviderCostDollars: number,
  highProviderCostDollars: number,
  policy?: PricingPolicy
): ExecutionPriceRange {
  return {
    lowCents: calculateExecutionPrice({ providerCostDollars: lowProviderCostDollars, policy }).estimatedCustomerPriceCents,
    highCents: calculateExecutionPrice({ providerCostDollars: highProviderCostDollars, policy }).estimatedCustomerPriceCents,
  };
}
