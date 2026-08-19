import fs from "node:fs/promises";
import path from "node:path";
import { Capability, ProviderPerformanceMetrics, ProviderPerformanceRecord } from "@/types";

const PERFORMANCE_PATH = path.join(process.cwd(), "data", "provider-performance.json");

function key(providerId: string, capability: Capability): string {
  return `${providerId}::${capability}`;
}

async function readAll(): Promise<Record<string, ProviderPerformanceRecord>> {
  try {
    const raw = await fs.readFile(PERFORMANCE_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, ProviderPerformanceRecord>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeAll(records: Record<string, ProviderPerformanceRecord>): Promise<void> {
  await fs.writeFile(PERFORMANCE_PATH, JSON.stringify(records, null, 2), "utf-8");
}

/**
 * Every mutation here is a read-modify-write against one shared JSON file.
 * A single task fans out dozens of concurrent updates (one per claim per
 * step), so without serialization most of them silently clobber each
 * other. This queue chains every mutation onto the previous one so they
 * execute one at a time - still async, just never interleaved.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(mutation: (all: Record<string, ProviderPerformanceRecord>) => T): Promise<T> {
  const result = writeQueue.then(async () => {
    const all = await readAll();
    const value = mutation(all);
    await writeAll(all);
    return value;
  });
  // Swallow so one failed mutation doesn't poison the rest of the queue.
  writeQueue = result.catch(() => undefined);
  return result;
}

interface RecordAttemptInput {
  provider_id: string;
  capability: Capability;
  succeeded: boolean;
  confidence: number;
  latency_seconds: number;
  cost: number;
}

/**
 * Local performance history: every provider attempt updates this store, and
 * the router blends it back into future scoring (routing item 14) - the
 * system gradually becomes data-driven rather than relying solely on seeded
 * scores. Write failures are swallowed for the same read-only-filesystem
 * reason as task history: this is a feedback signal, not a dependency.
 */
export async function recordProviderAttempt(input: RecordAttemptInput): Promise<void> {
  try {
    await enqueue((all) => {
      const k = key(input.provider_id, input.capability);
      const existing = all[k] ?? emptyRecord(input.provider_id, input.capability);
      existing.tasks_attempted += 1;
      if (input.succeeded) existing.success_count += 1;
      existing.confidence_sum += input.confidence;
      existing.latency_sum += input.latency_seconds;
      existing.cost_sum += input.cost;
      all[k] = existing;
    });
  } catch (err) {
    console.warn("Could not persist provider performance:", err);
  }
}

/**
 * Records whether the Evaluator ended up verifying a claim this provider
 * supplied evidence for. Distinct from `recordProviderAttempt` - it only
 * touches verification_total/verification_pass_count, never
 * tasks_attempted, since the attempt itself was already recorded when the
 * provider executed.
 */
export async function recordVerificationOutcome(
  providerId: string,
  capability: Capability,
  passed: boolean
): Promise<void> {
  try {
    await enqueue((all) => {
      const k = key(providerId, capability);
      const existing = all[k] ?? emptyRecord(providerId, capability);
      existing.verification_total += 1;
      if (passed) existing.verification_pass_count += 1;
      all[k] = existing;
    });
  } catch (err) {
    console.warn("Could not persist verification outcome:", err);
  }
}

/**
 * Human feedback loop (V4 #22-23): accepting/rejecting a result nudges the
 * contributing providers' scores. Transparent, additive, no ML involved -
 * it just shifts the same historical_bonus term the router already reads.
 */
export async function recordProviderFeedback(
  providerId: string,
  capability: Capability,
  outcome: "accepted" | "rejected"
): Promise<void> {
  try {
    await enqueue((all) => {
      const k = key(providerId, capability);
      const existing = all[k] ?? emptyRecord(providerId, capability);
      if (outcome === "accepted") existing.accepted_count += 1;
      else existing.rejected_count += 1;
      all[k] = existing;
    });
  } catch (err) {
    console.warn("Could not persist provider feedback:", err);
  }
}

function emptyRecord(providerId: string, capability: Capability): ProviderPerformanceRecord {
  return {
    provider_id: providerId,
    capability,
    tasks_attempted: 0,
    success_count: 0,
    confidence_sum: 0,
    latency_sum: 0,
    cost_sum: 0,
    verification_pass_count: 0,
    verification_total: 0,
    accepted_count: 0,
    rejected_count: 0,
  };
}

export async function getPerformanceMetrics(
  providerId: string,
  capability: Capability
): Promise<ProviderPerformanceMetrics | undefined> {
  const all = await readAll();
  const record = all[key(providerId, capability)];
  if (!record) return undefined;
  return toMetrics(record);
}

export async function getAllPerformanceMetrics(): Promise<ProviderPerformanceMetrics[]> {
  const all = await readAll();
  return Object.values(all).map(toMetrics);
}

export async function getPerformanceMetricsForProvider(providerId: string): Promise<ProviderPerformanceMetrics[]> {
  const all = await readAll();
  return Object.values(all)
    .filter((r) => r.provider_id === providerId)
    .map(toMetrics);
}

function toMetrics(record: ProviderPerformanceRecord): ProviderPerformanceMetrics {
  const feedbackCount = record.accepted_count + record.rejected_count;
  return {
    provider_id: record.provider_id,
    capability: record.capability,
    tasks_attempted: record.tasks_attempted,
    success_rate: record.tasks_attempted > 0 ? round2(record.success_count / record.tasks_attempted) : 0,
    average_confidence: record.tasks_attempted > 0 ? round2(record.confidence_sum / record.tasks_attempted) : 0,
    average_latency: record.tasks_attempted > 0 ? round2(record.latency_sum / record.tasks_attempted) : 0,
    average_cost: record.tasks_attempted > 0 ? round2(record.cost_sum / record.tasks_attempted) : 0,
    verification_pass_rate:
      record.verification_total > 0 ? round2(record.verification_pass_count / record.verification_total) : 0,
    acceptance_rate: feedbackCount > 0 ? round2(record.accepted_count / feedbackCount) : 0,
    feedback_count: feedbackCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
