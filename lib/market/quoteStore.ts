import fs from "node:fs/promises";
import path from "node:path";
import { ExecutionOffer, ExecutionQuote } from "@/types";

const QUOTES_PATH = path.join(process.cwd(), "data", "execution-quotes.json");
/** Simple retention cap - this is a local JSON file, not a database. Oldest quotes drop first. */
const MAX_STORED_QUOTES = 5000;

async function readAll(): Promise<ExecutionQuote[]> {
  try {
    const raw = await fs.readFile(QUOTES_PATH, "utf-8");
    return JSON.parse(raw) as ExecutionQuote[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(quotes: ExecutionQuote[]): Promise<void> {
  await fs.writeFile(QUOTES_PATH, JSON.stringify(quotes, null, 2), "utf-8");
}

/**
 * Same serialized read-modify-write queue as performanceStore.ts, for the
 * same reason: many steps fan out concurrent writes to one shared JSON file.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
let idCounter = 0;

/**
 * Persists one ExecutionQuote per eligible executor for a step (V7 #6) - the
 * full quote list, not just the winner - so a future market dashboard can
 * show real competition ("3 quoted, 1 selected") instead of only the
 * outcome. Write failures are swallowed for the same reason as every other
 * store in this app: this is a feedback/transparency signal, not a
 * dependency the pipeline should ever fail because of.
 */
export async function recordQuotes(taskId: string, stepId: string, offers: ExecutionOffer[]): Promise<void> {
  if (offers.length === 0) return;
  const createdAt = new Date().toISOString();
  const quotes: ExecutionQuote[] = offers.map((offer) => ({
    id: `quote-${Date.now()}-${idCounter++}`,
    taskId,
    stepId,
    executorId: offer.executorId,
    capability: offer.capability,
    priceEstimate: offer.estimatedCost,
    latencyEstimateMs: offer.estimatedLatencyMs,
    qualityEstimate: offer.estimatedQuality,
    reliabilityEstimate: offer.reliability,
    createdAt,
  }));

  const result = writeQueue.then(async () => {
    const all = await readAll();
    all.push(...quotes);
    const trimmed = all.length > MAX_STORED_QUOTES ? all.slice(all.length - MAX_STORED_QUOTES) : all;
    await writeAll(trimmed);
  });
  writeQueue = result.catch(() => undefined);

  try {
    await result;
  } catch (err) {
    console.warn("Could not persist execution quotes:", err);
  }
}

export async function getQuotesForTask(taskId: string): Promise<ExecutionQuote[]> {
  const all = await readAll();
  return all.filter((q) => q.taskId === taskId);
}
