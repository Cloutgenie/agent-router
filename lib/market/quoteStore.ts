import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ExecutionOffer, ExecutionQuote } from "@/types";

let idCounter = 0;

/**
 * Persists one ExecutionQuote per eligible executor for a step (V7 #6) - the
 * full quote list, not just the winner - so a future market dashboard can
 * show real competition ("3 quoted, 1 selected") instead of only the
 * outcome. Backed by Postgres (`execution_quotes`) rather than a local JSON
 * file, which never actually persisted on Vercel (EROFS: read-only
 * filesystem). Write failures are still swallowed for the same reason as
 * every other store in this app: this is a feedback/transparency signal,
 * not a dependency the pipeline should ever fail because of.
 */
export async function recordQuotes(taskId: string, stepId: string, offers: ExecutionOffer[]): Promise<void> {
  if (offers.length === 0) return;
  const createdAt = new Date().toISOString();
  const rows = offers.map((offer) => ({
    id: `quote-${Date.now()}-${idCounter++}`,
    task_id: taskId,
    step_id: stepId,
    executor_id: offer.executorId,
    capability: offer.capability,
    price_estimate: offer.estimatedCost,
    latency_estimate_ms: offer.estimatedLatencyMs,
    quality_estimate: offer.estimatedQuality,
    reliability_estimate: offer.reliability,
    created_at: createdAt,
  }));

  try {
    const { error } = await getSupabaseClient().from("execution_quotes").insert(rows);
    if (error) throw error;
  } catch (err) {
    console.warn("Could not persist execution quotes:", err);
  }
}

function toQuote(row: Record<string, unknown>): ExecutionQuote {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    stepId: row.step_id as string,
    executorId: row.executor_id as string,
    capability: row.capability as ExecutionQuote["capability"],
    priceEstimate: row.price_estimate as number,
    latencyEstimateMs: row.latency_estimate_ms as number,
    qualityEstimate: row.quality_estimate as number,
    reliabilityEstimate: row.reliability_estimate as number,
    createdAt: row.created_at as string,
  };
}

export async function getQuotesForTask(taskId: string): Promise<ExecutionQuote[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient().from("execution_quotes").select("*").eq("task_id", taskId);
  if (error) throw error;
  return (data ?? []).map(toQuote);
}

/** Every persisted quote - for market-wide analytics (Execution Alpha, capability liquidity) that need the full set, not one task's. */
export async function getAllQuotes(): Promise<ExecutionQuote[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient().from("execution_quotes").select("*");
  if (error) throw error;
  return (data ?? []).map(toQuote);
}
