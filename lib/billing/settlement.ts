import { dollarsToCents } from "./pricing";
import { Task, TaskSettlement } from "@/types";

/**
 * Settlement-ready accounting (spec #30) - a read-only, derived preview of
 * what each step's executor would be owed if third-party payouts (Stripe
 * Connect) were active, and what the platform would keep. Nothing here
 * writes anywhere or moves money; it's a pure computation over a task's
 * own already-persisted plan/economics, the same "derived view over
 * existing data" pattern as Execution Alpha and Market Gaps.
 *
 * Model: each completed step's own provider cost becomes that step's
 * hypothetical executor payout (what the executor charged, pass-through -
 * the same number this app already pays out to Tavily/Apollo/etc. today,
 * just reframed as a marketplace payout); the task's overall platform fee
 * (`TaskEconomics.platformCostCents`) is apportioned across steps by cost
 * share, since there's no per-step platform-fee breakdown to read
 * directly.
 */
export function computeTaskSettlement(task: Task): TaskSettlement | undefined {
  if (!task.economics) return undefined; // demo mode, or a task from before billing existed - never settled

  const completedSteps = task.plan.steps.filter((s) => s.status === "completed" && s.result && s.selectedProviderId);
  const totalProviderCostDollars = completedSteps.reduce((sum, s) => sum + (s.result?.cost ?? 0), 0);

  if (totalProviderCostDollars <= 0 || completedSteps.length === 0) {
    return { taskId: task.id, totalExecutorPayoutCents: 0, totalPlatformFeeCents: task.economics.platformCostCents, lines: [] };
  }

  const lines = completedSteps.map((step) => {
    const stepCostDollars = step.result?.cost ?? 0;
    const shareOfTotal = stepCostDollars / totalProviderCostDollars;
    const candidate = step.candidates.find((c) => c.provider_id === step.selectedProviderId);
    return {
      executorId: step.selectedProviderId!,
      executorName: candidate?.provider_name ?? step.selectedProviderId!,
      stepId: step.id,
      capability: step.capability,
      executorPayoutCents: dollarsToCents(stepCostDollars),
      platformFeeCents: Math.round(task.economics!.platformCostCents * shareOfTotal),
    };
  });

  return {
    taskId: task.id,
    totalExecutorPayoutCents: lines.reduce((sum, l) => sum + l.executorPayoutCents, 0),
    totalPlatformFeeCents: lines.reduce((sum, l) => sum + l.platformFeeCents, 0),
    lines,
  };
}

export interface ExecutorSettlementTotals {
  executorId: string;
  executorName: string;
  taskCount: number;
  totalPayoutCents: number;
}

/** Aggregates per-executor payout totals across many tasks (e.g. a billing period) - the /admin/payouts summary. */
export function aggregateSettlements(tasks: Task[]): ExecutorSettlementTotals[] {
  const byExecutor = new Map<string, ExecutorSettlementTotals>();

  for (const task of tasks) {
    const settlement = computeTaskSettlement(task);
    if (!settlement) continue;
    for (const line of settlement.lines) {
      const existing = byExecutor.get(line.executorId) ?? {
        executorId: line.executorId,
        executorName: line.executorName,
        taskCount: 0,
        totalPayoutCents: 0,
      };
      existing.totalPayoutCents += line.executorPayoutCents;
      byExecutor.set(line.executorId, existing);
    }
  }

  // Count distinct tasks each executor appeared in, not steps - a separate pass so multi-step-per-task doesn't double count.
  for (const task of tasks) {
    const settlement = computeTaskSettlement(task);
    if (!settlement) continue;
    const executorsInTask = new Set(settlement.lines.map((l) => l.executorId));
    for (const executorId of executorsInTask) {
      const entry = byExecutor.get(executorId);
      if (entry) entry.taskCount += 1;
    }
  }

  return Array.from(byExecutor.values()).sort((a, b) => b.totalPayoutCents - a.totalPayoutCents);
}
