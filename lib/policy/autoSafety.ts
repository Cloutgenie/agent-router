import { getProviderOverride, setProviderOverride } from "@/lib/providers/overrideStore";
import { ProviderPerformanceRecord } from "@/types";

/**
 * Automatic safety disable (spec #34) - reacts to a provider's own recorded
 * performance history rather than running as a separate background job
 * (there isn't one in this app), so it fires the moment the signal that
 * would justify it actually lands: right after
 * lib/history/performanceStore.ts persists an attempt or a verification
 * outcome. Two of the spec's five triggers are covered by real, already-
 * tracked signals here (failure-rate spike, unsupported-claims/verification
 * spike, cost overage against an admin-set ceiling); malformed-response
 * rate and a dedicated false-contact detector aren't wired as distinct
 * tracked signals yet - see the README's "intentionally simplified" note.
 */

const MIN_SAMPLE_SIZE = 5;
const DEGRADE_FAILURE_RATE = 0.5;
const DISABLE_FAILURE_RATE = 0.85;
const DEGRADE_UNSUPPORTED_CLAIM_RATE = 0.5;
const COST_OVERAGE_MULTIPLIER = 1.5;

export type AutoSafetyAction = "none" | "degrade" | "disable";

export interface AutoSafetyDecision {
  action: AutoSafetyAction;
  reason?: string;
}

export function evaluateAutoSafetySignal(record: ProviderPerformanceRecord, maxCostPerTask?: number): AutoSafetyDecision {
  if (record.tasks_attempted >= MIN_SAMPLE_SIZE) {
    const failureRate = 1 - record.success_count / record.tasks_attempted;
    if (failureRate >= DISABLE_FAILURE_RATE) {
      return {
        action: "disable",
        reason: `Auto-disabled: ${Math.round(failureRate * 100)}% of the last ${record.tasks_attempted} attempts failed.`,
      };
    }
    if (failureRate >= DEGRADE_FAILURE_RATE) {
      return {
        action: "degrade",
        reason: `Auto-degraded: ${Math.round(failureRate * 100)}% of the last ${record.tasks_attempted} attempts failed.`,
      };
    }
  }

  if (record.verification_total >= MIN_SAMPLE_SIZE) {
    const unsupportedRate = 1 - record.verification_pass_count / record.verification_total;
    if (unsupportedRate >= DEGRADE_UNSUPPORTED_CLAIM_RATE) {
      return {
        action: "degrade",
        reason: `Auto-degraded: ${Math.round(unsupportedRate * 100)}% of this provider's claims failed independent verification over the last ${record.verification_total} checks.`,
      };
    }
  }

  if (maxCostPerTask != null && record.tasks_attempted >= MIN_SAMPLE_SIZE) {
    const avgCost = record.cost_sum / record.tasks_attempted;
    if (avgCost > maxCostPerTask * COST_OVERAGE_MULTIPLIER) {
      return {
        action: "degrade",
        reason: `Auto-degraded: average cost $${avgCost.toFixed(2)}/task is well above the configured $${maxCostPerTask.toFixed(2)} ceiling.`,
      };
    }
  }

  return { action: "none" };
}

const ACTION_RANK: Record<AutoSafetyAction, number> = { none: 0, degrade: 1, disable: 2 };

/**
 * Only ever escalates risk automatically - never lifts a restriction, and
 * never overwrites a manual override. Automation must not fight the
 * operator's own explicit choice; a human can always re-enable a provider
 * from /executors even if the underlying performance hasn't improved.
 */
export async function maybeAutoManage(providerId: string, record: ProviderPerformanceRecord): Promise<void> {
  const existing = await getProviderOverride(providerId);
  if (existing?.updatedBy === "manual") return;

  const decision = evaluateAutoSafetySignal(record, existing?.maxCostPerTask);
  if (decision.action === "none") return;

  const existingAction: AutoSafetyAction = !existing ? "none" : existing.enabled === false ? "disable" : existing.degraded ? "degrade" : "none";
  if (ACTION_RANK[decision.action] <= ACTION_RANK[existingAction]) return;

  await setProviderOverride(
    providerId,
    decision.action === "disable"
      ? { enabled: false, degraded: true, reason: decision.reason }
      : { degraded: true, reason: decision.reason },
    "auto"
  );
}
