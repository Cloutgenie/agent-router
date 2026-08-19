import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        const err = new Error("not found") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
  },
}));

describe("stripe event log", () => {
  beforeEach(() => {
    files.clear();
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
    const fs = (await import("node:fs/promises")).default;
    const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls.at(-1)![1] as string);
    expect(written.filter((id: string) => id === "evt_1")).toHaveLength(1);
  });
});
