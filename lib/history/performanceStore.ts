import { maybeAutoManage } from "@/lib/policy/autoSafety";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Capability, ProviderPerformanceMetrics, ProviderPerformanceRecord, TimestampedOutcome } from "@/types";

/** Bounded recency log (V7 #13) - old entries drop first; the lifetime counters above are untouched by this cap. */
const MAX_RECENT_OUTCOMES = 200;

function pushRecent(log: TimestampedOutcome[] | undefined, passed: boolean): TimestampedOutcome[] {
  const next = [...(log ?? []), { timestamp: new Date().toISOString(), passed }];
  return next.length > MAX_RECENT_OUTCOMES ? next.slice(next.length - MAX_RECENT_OUTCOMES) : next;
}

function key(providerId: string, capability: Capability): string {
  return `${providerId}::${capability}`;
}

/**
 * Every one of these reads runs during routing (the router scores every
 * candidate against its historical performance) - unconfigured persistence
 * must degrade to "no history yet" (cold start, same as a brand-new
 * provider), never throw and block routing entirely.
 */
async function readOne(k: string): Promise<ProviderPerformanceRecord | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const { data, error } = await getSupabaseClient().from("provider_performance").select("data").eq("key", k).maybeSingle();
  if (error) throw error;
  return data?.data as ProviderPerformanceRecord | undefined;
}

async function readAll(): Promise<Record<string, ProviderPerformanceRecord>> {
  if (!isSupabaseConfigured()) return {};
  const { data, error } = await getSupabaseClient().from("provider_performance").select("key, data");
  if (error) throw error;
  const all: Record<string, ProviderPerformanceRecord> = {};
  for (const row of data ?? []) all[row.key] = row.data as ProviderPerformanceRecord;
  return all;
}

async function writeOne(k: string, record: ProviderPerformanceRecord): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("provider_performance")
    .upsert({ key: k, provider_id: record.provider_id, capability: record.capability, data: record });
  if (error) throw error;
}

/**
 * Reads then writes the one row for `providerId::capability` - Postgres
 * upsert is atomic per-row, so (unlike the local-JSON-file version this
 * replaced) this is durable and survives a serverless restart. Replaces
 * `data/provider-performance.json`, which never actually persisted on
 * Vercel (EROFS: read-only filesystem).
 */
async function mutate<T>(providerId: string, capability: Capability, fn: (record: ProviderPerformanceRecord) => T): Promise<T> {
  const k = key(providerId, capability);
  const existing = (await readOne(k)) ?? emptyRecord(providerId, capability);
  const value = fn(existing);
  await writeOne(k, existing);
  return value;
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
 * scores. Write failures are swallowed for the same "never break the
 * pipeline over a feedback signal" reason as every other store here.
 */
export async function recordProviderAttempt(input: RecordAttemptInput): Promise<void> {
  try {
    const updated = await mutate(input.provider_id, input.capability, (existing) => {
      existing.tasks_attempted += 1;
      if (input.succeeded) existing.success_count += 1;
      existing.confidence_sum += input.confidence;
      existing.latency_sum += input.latency_seconds;
      existing.cost_sum += input.cost;
      existing.recent_attempts = pushRecent(existing.recent_attempts, input.succeeded);
      return existing;
    });
    await maybeAutoManage(input.provider_id, updated);
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
    const updated = await mutate(providerId, capability, (existing) => {
      existing.verification_total += 1;
      if (passed) existing.verification_pass_count += 1;
      existing.recent_verifications = pushRecent(existing.recent_verifications, passed);
      return existing;
    });
    await maybeAutoManage(providerId, updated);
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
    await mutate(providerId, capability, (existing) => {
      if (outcome === "accepted") existing.accepted_count += 1;
      else existing.rejected_count += 1;
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
    recent_attempts: [],
    recent_verifications: [],
  };
}

export async function getPerformanceMetrics(
  providerId: string,
  capability: Capability
): Promise<ProviderPerformanceMetrics | undefined> {
  const record = await readOne(key(providerId, capability));
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
    success_count: record.success_count,
    verification_pass_count: record.verification_pass_count,
    verification_total: record.verification_total,
    accepted_count: record.accepted_count,
    rejected_count: record.rejected_count,
    // Defensive fallback: records persisted before V7's reputation-decay
    // batch won't have these fields yet.
    recent_attempts: record.recent_attempts ?? [],
    recent_verifications: record.recent_verifications ?? [],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
