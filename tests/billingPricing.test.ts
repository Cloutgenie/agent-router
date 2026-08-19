import { describe, expect, it } from "vitest";
import {
  calculateExecutionPrice,
  centsToDollars,
  dollarsToCents,
  DEFAULT_PRICING_POLICY,
  estimateExecutionPriceRange,
} from "@/lib/billing/pricing";

describe("dollarsToCents / centsToDollars", () => {
  it("round-trips cleanly and avoids floating-point drift", () => {
    expect(dollarsToCents(1.42)).toBe(142);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30); // the classic float trap - must land on 30, not 29 or 31
    expect(centsToDollars(142)).toBe(1.42);
  });
});

describe("calculateExecutionPrice", () => {
  it("applies the configured markup percentage over provider + verification cost", () => {
    const price = calculateExecutionPrice({
      providerCostDollars: 1,
      verificationCostDollars: 0,
      policy: { markupPercent: 50, minimumFeeCents: 1 },
    });
    expect(price.estimatedProviderCostCents).toBe(100);
    expect(price.platformFeeCents).toBe(50);
    expect(price.estimatedCustomerPriceCents).toBe(150);
  });

  it("never charges below the minimum fee, even for a near-free task", () => {
    const price = calculateExecutionPrice({
      providerCostDollars: 0.02,
      policy: { markupPercent: 10, minimumFeeCents: 25 },
    });
    expect(price.estimatedCustomerPriceCents).toBe(25);
    expect(price.platformFeeCents).toBe(25 - 2); // the gap the minimum fee closed
  });

  it("includes verification cost in the base before markup", () => {
    const price = calculateExecutionPrice({
      providerCostDollars: 1,
      verificationCostDollars: 1,
      policy: { markupPercent: 0, minimumFeeCents: 1 },
    });
    expect(price.verificationCostCents).toBe(100);
    expect(price.estimatedCustomerPriceCents).toBe(200);
  });

  it("uses the default policy when none is supplied", () => {
    const price = calculateExecutionPrice({ providerCostDollars: 10 });
    expect(price.estimatedCustomerPriceCents).toBeGreaterThan(1000); // some markup was applied
    expect(price.platformFeeCents).toBeGreaterThan(0);
    void DEFAULT_PRICING_POLICY; // exported for callers to reference/override
  });
});

describe("estimateExecutionPriceRange", () => {
  it("produces a low/high band, not a single falsely-precise number", () => {
    const range = estimateExecutionPriceRange(1, 3, { markupPercent: 20, minimumFeeCents: 1 });
    expect(range.lowCents).toBeLessThan(range.highCents);
    expect(range.lowCents).toBe(120);
    expect(range.highCents).toBe(360);
  });
});
