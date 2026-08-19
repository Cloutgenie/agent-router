import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("stripe client config helpers", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("isStripeConfigured is false without a secret key, true with one", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { isStripeConfigured } = await import("@/lib/billing/stripe/client");
    expect(isStripeConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    expect(isStripeConfigured()).toBe(true);
  });

  it("getStripeClient throws a clear error when unconfigured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripeClient } = await import("@/lib/billing/stripe/client");
    expect(() => getStripeClient()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("priceIdForPlan/planForPriceId round-trip through the configured env vars", async () => {
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_BUSINESS_PRICE_ID = "price_business";
    const { priceIdForPlan, planForPriceId } = await import("@/lib/billing/stripe/client");

    expect(priceIdForPlan("pro")).toBe("price_pro");
    expect(planForPriceId("price_pro")).toBe("pro");
    expect(planForPriceId("price_unknown")).toBeUndefined();
  });

  it("appUrl falls back to localhost when NEXT_PUBLIC_APP_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { appUrl } = await import("@/lib/billing/stripe/client");
    expect(appUrl()).toBe("http://localhost:3000");
  });
});
