/**
 * Global (process-wide, not per-task) in-flight call counter per provider
 * (spec #35 - "prevent runaway browser and LLM workloads"). Deliberately
 * fails fast rather than queuing: if a provider is at its concurrency cap,
 * the step treats it as ineligible for this attempt and the existing
 * fallback chain takes over, consistent with "never fail the whole task
 * unnecessarily" elsewhere in this engine.
 */
const activeRuns = new Map<string, number>();

export function activeRunCount(providerId: string): number {
  return activeRuns.get(providerId) ?? 0;
}

export function isAtConcurrencyLimit(providerId: string, maxConcurrentRuns: number | undefined): boolean {
  if (maxConcurrentRuns == null) return false;
  return activeRunCount(providerId) >= maxConcurrentRuns;
}

export function beginRun(providerId: string): void {
  activeRuns.set(providerId, activeRunCount(providerId) + 1);
}

export function endRun(providerId: string): void {
  const next = activeRunCount(providerId) - 1;
  if (next <= 0) activeRuns.delete(providerId);
  else activeRuns.set(providerId, next);
}
