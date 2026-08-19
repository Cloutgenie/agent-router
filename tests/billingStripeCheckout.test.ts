import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSession = vi.fn(async () => ({ url: "https://checkout.stripe.com/session_123" }));
const originalEnv = { ...process.env };

vi.mock("@/lib/billing/stripe/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/stripe/client")>("@/lib/billing/stripe/client");
  return {
    ...actual,
    getStripeClient: () => ({ checkout: { sessions: { create: createSession } } }),
  };
});

describe("createCheckoutSession", () => {
  beforeEach(() => {
    createSession.mockClear();
    process.env = { ...originalEnv, STRIPE_PRO_PRICE_ID: "price_pro" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear error when the plan has no configured price id", async () => {
    delete process.env.STRIPE_STARTER_PRICE_ID;
    const { createCheckoutSession, MissingPriceIdError } = await import("@/lib/billing/stripe/checkout");
    await expect(createCheckoutSession("starter", "cus_1")).rejects.toThrow(MissingPriceIdError);
  });

  it("creates a subscription-mode session with the right price and customer", async () => {
    const { createCheckoutSession } = await import("@/lib/billing/stripe/checkout");
    const result = await createCheckoutSession("pro", "cus_1");
    expect(result.url).toBe("https://checkout.stripe.com/session_123");
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_1",
        line_items: [{ price: "price_pro", quantity: 1 }],
      })
    );
  });
});
