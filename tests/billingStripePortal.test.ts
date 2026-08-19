import { beforeEach, describe, expect, it, vi } from "vitest";

const createPortalSession = vi.fn(async () => ({ url: "https://billing.stripe.com/portal_session_123" }));

vi.mock("@/lib/billing/stripe/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/stripe/client")>("@/lib/billing/stripe/client");
  return {
    ...actual,
    getStripeClient: () => ({ billingPortal: { sessions: { create: createPortalSession } } }),
  };
});

describe("createPortalSession", () => {
  beforeEach(() => {
    createPortalSession.mockClear();
  });

  it("creates a portal session for the given customer", async () => {
    const { createPortalSession: create } = await import("@/lib/billing/stripe/portal");
    const result = await create("cus_1");
    expect(result.url).toBe("https://billing.stripe.com/portal_session_123");
    expect(createPortalSession).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
  });
});
