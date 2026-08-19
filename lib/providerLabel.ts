import { ExecutionStep } from "@/types";

/**
 * The provider that actually ran a step, by name - not whichever candidate
 * routing originally picked. `step.candidates[].selected` is frozen at
 * routing time and never updated when a later candidate wins after a
 * fallback; `step.selectedProviderId` is the one field the execution engine
 * keeps correctly pointed at whoever actually completed the step (see
 * lib/execution/stepEngine.ts::runStepWithFallback). Every "via X" label in
 * the UI and trace should resolve through this, not `candidates.find(c =>
 * c.selected)`, or a successful fallback gets attributed to the provider
 * that actually failed.
 */
export function actualProviderName(step: ExecutionStep): string | undefined {
  if (!step.selectedProviderId) return undefined;
  return step.candidates.find((c) => c.provider_id === step.selectedProviderId)?.provider_name ?? step.selectedProviderId;
}
