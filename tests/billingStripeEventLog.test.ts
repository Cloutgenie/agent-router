import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./helpers/fakeSupabase";

const fakeSupabase = createFakeSupabase();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => fakeSupabase,
  isSupabaseConfigured: () => true,
}));

describe("stripe event log", () => {
  beforeEach(() => {
    fakeSupabase.tables.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports an unseen event id as not processed", async () => {
    const { hasProcessedEvent } = await import("@/lib/billing/stripe/eventLog");
    expect(await hasProcessedEvent("evt_1")).toBe(false);
  });

  it("marks an event processed and then reports it as such", async () => {
    const { hasProcessedEvent, markEventProcessed } = await import("@/lib/billing/stripe/eventLog");
    await markEventProcessed("evt_1");
    expect(await hasProcessedEvent("evt_1")).toBe(true);
  });

  it("does not duplicate an id marked processed twice", async () => {
    const { markEventProcessed } = await import("@/lib/billing/stripe/eventLog");
    await markEventProcessed("evt_1");
    await markEventProcessed("evt_1");
    const rows = fakeSupabase.tables.get("stripe_events") ?? [];
    expect(rows.filter((r) => r.event_id === "evt_1")).toHaveLength(1);
  });
});
