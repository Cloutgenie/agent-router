import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMeterEvent = vi.fn(async (_params: { event_name: string; identifier: string; payload: Record<string, string> }) => ({
  object: "billing.meter_event",
}));
const originalEnv = { ...process.env };

vi.mock("@/lib/billing/stripe/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/stripe/client")>("@/lib/billing/stripe/client");
  return {
    ...actual,
    getStripeClient: () => ({ billing: { meterEvents: { create: createMeterEvent } } }),
  };
});

describe("isMeteredReportingConfigured", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false without both a Stripe secret key and a meter event name", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_EXECUTION_METER_EVENT_NAME;
    const { isMeteredReportingConfigured } = await import("@/lib/billing/stripe/usageReporting");
    expect(isMeteredReportingConfigured()).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    expect(isMeteredReportingConfigured()).toBe(false); // still missing the meter event name

    process.env.STRIPE_EXECUTION_METER_EVENT_NAME = "execution_overage";
    expect(isMeteredReportingConfigured()).toBe(true);
  });
});

describe("reportOverageToStripe", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_EXECUTION_METER_EVENT_NAME: "execution_overage" };
    createMeterEvent.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does nothing for zero or negative overage", async () => {
    const { reportOverageToStripe } = await import("@/lib/billing/stripe/usageReporting");
    await reportOverageToStripe({ customerId: "cus_1", overageCents: 0, taskId: "t1" });
    await reportOverageToStripe({ customerId: "cus_1", overageCents: -5, taskId: "t1" });
    expect(createMeterEvent).not.toHaveBeenCalled();
  });

  it("does nothing when the meter event name isn't configured, even with real overage", async () => {
    delete process.env.STRIPE_EXECUTION_METER_EVENT_NAME;
    const { reportOverageToStripe } = await import("@/lib/billing/stripe/usageReporting");
    await reportOverageToStripe({ customerId: "cus_1", overageCents: 500, taskId: "t1" });
    expect(createMeterEvent).not.toHaveBeenCalled();
  });

  it("reports overage as a meter event keyed by customer id, in cents", async () => {
    const { reportOverageToStripe } = await import("@/lib/billing/stripe/usageReporting");
    await reportOverageToStripe({ customerId: "cus_1", overageCents: 742, taskId: "task-abc" });
    expect(createMeterEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "execution_overage",
        identifier: "overage-task-abc",
        payload: { stripe_customer_id: "cus_1", value: "742" },
      })
    );
  });

  it("uses the task id as the idempotency identifier, so a retried report for the same task is distinguishable from a new one", async () => {
    const { reportOverageToStripe } = await import("@/lib/billing/stripe/usageReporting");
    await reportOverageToStripe({ customerId: "cus_1", overageCents: 100, taskId: "task-1" });
    await reportOverageToStripe({ customerId: "cus_1", overageCents: 200, taskId: "task-2" });
    const identifiers = createMeterEvent.mock.calls.map((call) => call[0].identifier);
    expect(identifiers).toEqual(["overage-task-1", "overage-task-2"]);
  });
});
