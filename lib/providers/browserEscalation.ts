import { Evidence } from "@/types";

export interface HiringSignalInfo {
  hiringSignal?: string;
  evidence?: Evidence[];
}

/**
 * Shared "is browser verification worth it" rule (spec #24), used by both
 * the mock (lib/providers/mock/browserExecutor.ts) and real
 * (lib/providers/adapters/browserExecutor.ts) browser executors so Demo and
 * Live Mode escalate for the same reason: an already-confident upstream
 * hiring signal doesn't need a live page check, and one that's missing or
 * weak does.
 */
export function needsBrowserEscalation(hiringInfo: HiringSignalInfo): boolean {
  const evidence = hiringInfo.evidence ?? [];
  if (evidence.length === 0) return true;
  const avgConfidence = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length;
  return avgConfidence < 0.75;
}
