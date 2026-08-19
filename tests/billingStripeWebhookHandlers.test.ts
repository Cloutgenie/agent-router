import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingAccount } from "@/types";
import Stripe from "stripe";

let account: BillingAccount;
const updateBillingAccountMock = vi.fn(async (patch: Partial<BillingAccount>) => {
  account = { ...account, ...patch };
  return account;
});
const ensurePeriodCreditProvisionedMock = vi.fn(async () => undefined);

vi.mock("@/lib/billing/account", () => ({
  getBillingAccount: () => account,
  updateBillingAccount: (patch: Partial<BillingAccount>) => updateBillingAccountMock(patch),
}));

vi.mock("@/lib/billing/usage", () => ({
  ensurePeriodCreditProvisioned: () => ensurePeriodCreditProvisionedMock(),
}));

vi.mock("@/lib/billing/stripe/client", () => ({
  planForPriceId: (priceId: string) => (priceId === "price_pro" ? "pro" : priceId === "price_business" ? "business" : undefined),
}));

function makeAccount(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: "acct-1",
    userId: "u1",
    stripeCustomerId: "cus_1",
    subscriptionId: null,
    plan: "starter",
    status: "inactive",
    spendingLimits: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// Minimal fakes matching only the fields these handlers actually read, per
// the installed `stripe` SDK's real types (confirmed by reading
// node_modules/stripe's .d.ts files directly before writing this - period
// dates live on the subscription ITEM, not the subscription itself, in
// this API version).
function makeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    items: {
      data: [
        {
          price: { id: "price_pro" },
          current_period_start: 1735689600, // 2025-01-01T00:00:00Z
          current_period_end: 1738368000, // 2025-02-01T00:00:00Z
        },
      ],
    },
    ...overrides,
  } as Stripe.Subscription;
}

function makeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return { id: "in_1", customer: "cus_1", ...overrides } as Stripe.Invoice;
}

describe("stripe webhook handlers", () => {
  beforeEach(() => {
    account = makeAccount();
    updateBillingAccountMock.mockClear();
    ensurePeriodCreditProvisionedMock.mockClear();
  });

  describe("handleSubscriptionCreated / handleSubscriptionUpdated", () => {
    it("syncs plan, status, and period from the subscription's price id", async () => {
      const { handleSubscriptionCreated } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleSubscriptionCreated(makeSubscription());
      expect(updateBillingAccountMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: "sub_1",
          status: "active",
          plan: "pro",
          currentPeriodStart: new Date(1735689600 * 1000).toISOString(),
          currentPeriodEnd: new Date(1738368000 * 1000).toISOString(),
        })
      );
    });

    it("does nothing for an event belonging to a different customer than this account's", async () => {
      const { handleSubscriptionUpdated } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleSubscriptionUpdated(makeSubscription({ customer: "cus_someone_else" }));
      expect(updateBillingAccountMock).not.toHaveBeenCalled();
    });

    it("leaves the current plan untouched for an unrecognized price id, rather than guessing", async () => {
      const { handleSubscriptionUpdated } = await import("@/lib/billing/stripe/webhookHandlers");
      const sub = makeSubscription({ items: { data: [{ price: { id: "price_unknown" }, current_period_start: 1, current_period_end: 2 }] } as never });
      await handleSubscriptionUpdated(sub);
      const call = updateBillingAccountMock.mock.calls.at(-1)![0];
      expect(call).not.toHaveProperty("plan");
    });

    it("maps every Stripe subscription status to this app's BillingStatus", async () => {
      const { handleSubscriptionUpdated } = await import("@/lib/billing/stripe/webhookHandlers");
      const cases: Array<[Stripe.Subscription.Status, string]> = [
        ["active", "active"],
        ["trialing", "trialing"],
        ["past_due", "past_due"],
        ["canceled", "canceled"],
        ["unpaid", "unpaid"],
        ["incomplete", "inactive"],
        ["incomplete_expired", "inactive"],
        ["paused", "inactive"],
      ];
      for (const [stripeStatus, expected] of cases) {
        await handleSubscriptionUpdated(makeSubscription({ status: stripeStatus }));
        expect(updateBillingAccountMock.mock.calls.at(-1)![0]).toMatchObject({ status: expected });
      }
    });
  });

  describe("handleSubscriptionDeleted", () => {
    it("marks the account canceled without touching anything else", async () => {
      const { handleSubscriptionDeleted } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleSubscriptionDeleted(makeSubscription());
      expect(updateBillingAccountMock).toHaveBeenCalledWith({ status: "canceled" });
    });
  });

  describe("handleCheckoutSessionCompleted", () => {
    it("stores the subscription id from a completed checkout session", async () => {
      const { handleCheckoutSessionCompleted } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleCheckoutSessionCompleted({ customer: "cus_1", subscription: "sub_new" } as Stripe.Checkout.Session);
      expect(updateBillingAccountMock).toHaveBeenCalledWith({ subscriptionId: "sub_new" });
    });
  });

  describe("handleInvoicePaid", () => {
    it("provisions the period's included credit for this account's customer", async () => {
      const { handleInvoicePaid } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleInvoicePaid(makeInvoice());
      expect(ensurePeriodCreditProvisionedMock).toHaveBeenCalledTimes(1);
    });

    it("does nothing for a different customer", async () => {
      const { handleInvoicePaid } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleInvoicePaid(makeInvoice({ customer: "cus_other" }));
      expect(ensurePeriodCreditProvisionedMock).not.toHaveBeenCalled();
    });
  });

  describe("handleInvoicePaymentFailed", () => {
    it("marks the account past_due", async () => {
      const { handleInvoicePaymentFailed } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleInvoicePaymentFailed(makeInvoice());
      expect(updateBillingAccountMock).toHaveBeenCalledWith({ status: "past_due" });
    });
  });

  describe("handleStripeEvent", () => {
    it("routes a known event type to its handler", async () => {
      const { handleStripeEvent } = await import("@/lib/billing/stripe/webhookHandlers");
      await handleStripeEvent({ type: "invoice.paid", data: { object: makeInvoice() } } as Stripe.Event);
      expect(ensurePeriodCreditProvisionedMock).toHaveBeenCalledTimes(1);
    });

    it("does not throw for an unhandled event type - just acknowledges it", async () => {
      const { handleStripeEvent } = await import("@/lib/billing/stripe/webhookHandlers");
      await expect(handleStripeEvent({ type: "invoice.created", data: { object: makeInvoice() } } as Stripe.Event)).resolves.toBeUndefined();
      expect(updateBillingAccountMock).not.toHaveBeenCalled();
    });
  });
});
