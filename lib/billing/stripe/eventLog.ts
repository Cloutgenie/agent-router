import fs from "node:fs/promises";
import path from "node:path";

const EVENT_LOG_PATH = path.join(process.cwd(), "data", "stripe-events.json");
/** Simple retention cap - this is a local JSON file, not a database. Oldest ids drop first. */
const MAX_STORED_EVENTS = 2000;

async function readAll(): Promise<string[]> {
  try {
    const raw = await fs.readFile(EVENT_LOG_PATH, "utf-8");
    return JSON.parse(raw) as string[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(ids: string[]): Promise<void> {
  await fs.writeFile(EVENT_LOG_PATH, JSON.stringify(ids, null, 2), "utf-8");
}

/**
 * Processed Stripe event ids (spec #13) - webhook delivery is at-least-once,
 * so the same event can arrive twice. Same serialized-write-queue pattern
 * as ledger.ts/quoteStore.ts.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  const all = await readAll();
  return all.includes(eventId);
}

export async function markEventProcessed(eventId: string): Promise<void> {
  const result = writeQueue.then(async () => {
    const all = await readAll();
    if (all.includes(eventId)) return;
    all.push(eventId);
    const trimmed = all.length > MAX_STORED_EVENTS ? all.slice(all.length - MAX_STORED_EVENTS) : all;
    await writeAll(trimmed);
  });
  writeQueue = result.catch(() => undefined);
  await result;
}
