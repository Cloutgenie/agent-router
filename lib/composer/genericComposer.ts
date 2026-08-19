import { ExecutionPlan, FinalResult } from "@/types";

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return "";
  return String(value);
}

/**
 * Result Composer for generic (non buyer-discovery) tasks - carries over
 * V2's flat summary/highlights deliverable shape, now sourced from the
 * step-based execution plan instead of a single-shot agent team.
 */
export function composeGenericResult(plan: ExecutionPlan): FinalResult {
  const completed = plan.steps.filter((s) => s.status === "completed" && s.result);
  const failed = plan.steps.filter((s) => s.status === "failed");
  const awaitingApproval = plan.steps.filter((s) => s.status === "awaiting_approval");

  const summary =
    completed.length > 0
      ? `Completed ${completed.length} of ${plan.steps.length} routed research steps.`
      : "The routed providers were unable to complete this task.";

  const highlights: string[] = [];
  completed.forEach((step) => {
    Object.entries(step.result!.data).forEach(([key, value]) => {
      const formatted = formatValue(value);
      if (formatted) highlights.push(`${step.capability.replace(/-/g, " ")}: ${key.replace(/_/g, " ")} = ${formatted}`);
    });
  });
  if (failed.length > 0) {
    highlights.push(
      `${failed.length} step${failed.length > 1 ? "s" : ""} failed: ${failed
        .map((s) => s.capability.replace(/-/g, " "))
        .join(", ")}`
    );
  }
  if (awaitingApproval.length > 0) {
    highlights.push(
      `${awaitingApproval.length} step${awaitingApproval.length > 1 ? "s" : ""} blocked pending approval: ${awaitingApproval
        .map((s) => s.capability.replace(/-/g, " "))
        .join(", ")}`
    );
  }

  const outputs: Record<string, unknown> = {};
  plan.steps.forEach((step) => {
    outputs[step.capability] = step.result?.data ?? {};
  });

  return { summary, highlights, outputs };
}
