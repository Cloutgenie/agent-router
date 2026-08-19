import { randomUUID } from "node:crypto";
import { capabilityClassifier } from "@/lib/capabilities/classifier";
import { getRuntimeConfig, RuntimeConfig } from "@/lib/config";
import { composeBuyerResults } from "@/lib/composer/buyerComposer";
import { composeGenericResult } from "@/lib/composer/genericComposer";
import { executeStepGraph, StepEvent } from "@/lib/execution/stepEngine";
import { detectWorkflow, buildExecutionPlan } from "@/lib/planner/taskPlanner";
import { getHistoryTask, saveTaskToHistory } from "@/lib/history/store";
import { recordVerificationOutcome } from "@/lib/history/performanceStore";
import { getEligibleProviders } from "@/lib/providers/registry";
import { applyFollowUp, buildFollowUpPlan, FOLLOW_UP_LABELS } from "@/lib/composer/followUp";
import {
  BuyerRecord,
  BudgetOutcome,
  Capability,
  EvaluationSummary,
  ExecutionPlan,
  ExecutionStep,
  FollowUpAction,
  StrategyComparison,
  StrategyRunSummary,
  Task,
  TaskConstraints,
  TraceEvent,
} from "@/types";

export type PipelineEvent =
  | { type: "trace"; event: TraceEvent }
  | { type: "capabilities"; data: Capability[] }
  | { type: "plan"; data: ExecutionPlan }
  | { type: "step"; data: ExecutionStep }
  | { type: "final"; data: Task }
  | { type: "error"; message: string };

const STEP_LIVE_LABELS: Record<string, string> = {
  discover: "Discovering companies",
  funding: "Checking funding",
  "ai-signal": "Analyzing AI/security signals",
  hiring: "Checking hiring",
  contact: "Finding decision makers",
  validate: "Verifying claims",
};

function nowIso(): string {
  return new Date().toISOString();
}

function friendlyStepLabel(step: ExecutionStep): string {
  return STEP_LIVE_LABELS[step.id] ?? `Running ${step.capability.replace(/-/g, " ")}`;
}

function estimatePlanCost(plan: ExecutionPlan, mode: Task["mode"], config: RuntimeConfig): number {
  let total = 0;
  for (const step of plan.steps) {
    const providers = getEligibleProviders(step.capability, mode, config);
    if (providers.length === 0) continue;
    const prices = providers.map((p) => p.price_per_task).sort((a, b) => a - b);
    total += prices[Math.floor(prices.length / 2)];
  }
  return Math.round(total * 100) / 100;
}

function computeEvaluationSummary(
  plan: ExecutionPlan,
  allowParallel: boolean,
  buyerResults: BuyerRecord[],
  excludedResults: BuyerRecord[]
): EvaluationSummary {
  const totalCost = Math.round(plan.steps.reduce((sum, s) => sum + (s.result?.cost ?? 0), 0) * 100) / 100;
  const durations = plan.steps.map((s) => s.result?.duration_seconds ?? 0);
  const totalLatency =
    Math.round((allowParallel ? Math.max(0, ...durations) : durations.reduce((s, d) => s + d, 0)) * 10) / 10;
  const providersUsed = new Set(plan.steps.map((s) => s.selectedProviderId).filter(Boolean)).size;

  const isBuyer = buyerResults.length > 0 || excludedResults.length > 0;
  const averageConfidence = isBuyer
    ? average(buyerResults.map((r) => r.confidence))
    : average(plan.steps.filter((s) => s.result?.status === "completed").map((s) => s.result!.confidence));
  const evidenceCoverage = isBuyer ? average(buyerResults.map((r) => r.verification.evidenceCoverage)) : 0;
  const verifiedClaimRate = isBuyer
    ? average(
        buyerResults.map((r) =>
          r.verification.totalClaimCount > 0 ? r.verification.verifiedClaimCount / r.verification.totalClaimCount : 0
        )
      )
    : 0;

  return {
    average_confidence: round2(averageConfidence),
    total_cost: totalCost,
    total_latency: totalLatency,
    providers_used: providersUsed,
    qualified_count: buyerResults.length,
    excluded_count: excludedResults.length,
    evidence_coverage: round2(evidenceCoverage),
    verified_claim_rate: round2(verifiedClaimRate),
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Which step (and therefore which provider) is responsible for each claim type. */
const CLAIM_TYPE_STEP_ID: Record<string, string> = {
  company_fit: "discover",
  funding: "funding",
  hiring: "hiring",
  security_signal: "hiring",
  ai_adoption: "ai-signal",
  contact: "contact",
};

/**
 * Feeds the Evaluator's per-claim verdicts back into provider performance
 * history (verification_pass_rate) - this is what lets the router's
 * historical_bonus and the /executors dashboard reflect whether a
 * provider's evidence actually held up, not just whether it returned
 * *something*.
 */
async function recordVerificationOutcomes(plan: ExecutionPlan, records: BuyerRecord[]): Promise<void> {
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  const updates: Promise<void>[] = [];

  for (const record of records) {
    for (const claim of record.verification.claims) {
      if (claim.evidenceIds.length === 0) continue; // nothing was attempted, nothing to score
      const stepId = CLAIM_TYPE_STEP_ID[claim.type];
      const step = stepId ? stepById.get(stepId) : undefined;
      if (!step?.selectedProviderId) continue;
      updates.push(recordVerificationOutcome(step.selectedProviderId, step.capability, claim.verified));
    }
  }

  await Promise.all(updates);
}

function computeBudgetOutcome(
  budget: number | undefined,
  estimated: number,
  actual: number,
  plan: ExecutionPlan
): BudgetOutcome | undefined {
  if (budget == null) return undefined;
  const adjustments: string[] = [];
  const sawBudgetPressure = plan.steps.some(
    (s) => s.candidates.find((c) => c.selected)?.within_budget === false
  );
  if (sawBudgetPressure) {
    adjustments.push("Some steps selected a lower-scoring provider to stay closer to budget.");
  }
  if (actual > budget) {
    adjustments.push("Executed cost exceeded the stated budget - raise it or lower the result count next time.");
  } else if (adjustments.length === 0) {
    adjustments.push("Stayed within budget with no provider downgrades needed.");
  }
  return { budget, estimated, actual, adjustments };
}

function toStrategySummary(
  strategy: "single" | "routed",
  plan: ExecutionPlan,
  results: BuyerRecord[],
  excluded: BuyerRecord[],
  allowParallel: boolean
): StrategyRunSummary {
  const summary = computeEvaluationSummary(plan, allowParallel, results, excluded);
  const providerNames = Array.from(
    new Set(
      plan.steps
        .map((s) => s.candidates.find((c) => c.selected)?.provider_name)
        .filter((n): n is string => Boolean(n))
    )
  );
  const failedCount = plan.steps.filter((s) => s.status === "failed").length;
  return {
    strategy,
    providerNames,
    quality: results.length > 0 ? Math.round(average(results.map((r) => r.opportunityScore.total))) : 0,
    evidenceCoverage: summary.evidence_coverage,
    verifiedClaimRate: summary.verified_claim_rate,
    totalCost: summary.total_cost,
    totalLatency: summary.total_latency,
    resultCount: results.length,
    failedCount,
  };
}

function compareStrategies(single: StrategyRunSummary, routed: StrategyRunSummary): StrategyComparison {
  const qualityDelta = routed.quality - single.quality;
  const evidenceCoverageDelta = round2(routed.evidenceCoverage - single.evidenceCoverage);
  const verifiedClaimRateDelta = round2(routed.verifiedClaimRate - single.verifiedClaimRate);
  const singleFailRate = single.failedCount + single.resultCount > 0 ? single.failedCount / (single.failedCount + single.resultCount) : 0;
  const routedFailRate = routed.failedCount + routed.resultCount > 0 ? routed.failedCount / (routed.failedCount + routed.resultCount) : 0;
  const failedRateDelta = round2(routedFailRate - singleFailRate);

  let winner: StrategyComparison["winner"] = "tie";
  if (qualityDelta > 2) winner = "routed";
  else if (qualityDelta < -2) winner = "single";

  return { single, routed, winner, qualityDelta, evidenceCoverageDelta, verifiedClaimRateDelta, failedRateDelta };
}

/** The single generalist most likely to be reached for if a user "just picked one provider." */
function pickSingleProviderBaseline(plan: ExecutionPlan, mode: Task["mode"], config: RuntimeConfig): string | undefined {
  const counts = new Map<string, number>();
  for (const step of plan.steps) {
    for (const provider of getEligibleProviders(step.capability, mode, config)) {
      counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

interface RunPipelineOptions {
  rawTask: string;
  constraints: TaskConstraints;
  parentTaskId?: string;
  rootTaskId?: string;
  followUpAction?: FollowUpAction;
  /** Pre-seeded plan for follow-up tasks (skips discovery, carries forward selected companies). */
  seededPlan?: ExecutionPlan;
  parentRecords?: BuyerRecord[];
}

/**
 * Runs the full GOAL -> TASK PLANNER -> CAPABILITY GRAPH -> ROUTER ->
 * PROVIDERS -> RAW EVIDENCE -> EVALUATOR -> RESULT COMPOSER -> OUTCOME
 * pipeline, yielding an event after each stage so the streaming API route
 * can push live progress to the client.
 */
export async function* runTaskPipeline(opts: RunPipelineOptions): AsyncGenerator<PipelineEvent, Task> {
  const { rawTask, constraints } = opts;
  const taskId = randomUUID();
  const traceId = `trace-${randomUUID()}`;
  const rootTaskId = opts.rootTaskId ?? opts.parentTaskId ?? taskId;
  const createdAt = nowIso();
  const config = getRuntimeConfig();
  const trace: TraceEvent[] = [];

  const emitTrace = (label: string, detail?: string): PipelineEvent => {
    const event: TraceEvent = { label, detail, timestamp: nowIso() };
    trace.push(event);
    return { type: "trace", event };
  };

  yield emitTrace("Task received", rawTask);
  yield emitTrace("Planning", `Mode: ${config.mode === "live" ? "Live" : "Demo"}`);

  const capabilities = capabilityClassifier.classify(rawTask);
  yield emitTrace(`Detected ${capabilities.length} capabilities`, capabilities.join(", "));
  yield { type: "capabilities", data: capabilities };

  const workflow = opts.followUpAction ? "buyer-discovery" : detectWorkflow(rawTask, capabilities);
  const plan = opts.seededPlan ?? buildExecutionPlan(rawTask, capabilities, workflow);
  yield emitTrace(`Created execution plan with ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`);
  yield { type: "plan", data: plan };

  for await (const stepEvent of executeStepGraph({
    taskId,
    traceId,
    rawTask,
    steps: plan.steps,
    resultCount: constraints.result_count ?? 15,
    mode: config.mode,
    constraints,
    config,
  })) {
    yield* translateStepEvent(stepEvent, emitTrace);
  }

  yield emitTrace("Verifying claims");

  let buyer_results: BuyerRecord[] = [];
  let excluded_results: BuyerRecord[] = [];
  let final_result: Task["final_result"];

  if (workflow === "buyer-discovery") {
    if (opts.followUpAction && opts.parentRecords) {
      buyer_results = applyFollowUp(opts.parentRecords, plan, opts.followUpAction);
      excluded_results = [];
    } else {
      const composed = composeBuyerResults(plan, constraints);
      buyer_results = composed.buyer_results;
      excluded_results = composed.excluded_results;
    }
  } else {
    final_result = composeGenericResult(plan);
  }

  if (buyer_results.length > 0 || excluded_results.length > 0) {
    await recordVerificationOutcomes(plan, [...buyer_results, ...excluded_results]);
  }

  yield emitTrace("Ranking opportunities", `${buyer_results.length} qualified, ${excluded_results.length} excluded`);

  const evaluation_summary = computeEvaluationSummary(plan, constraints.allow_parallel ?? true, buyer_results, excluded_results);
  const estimated = estimatePlanCost(plan, config.mode, config);
  const budget_outcome = computeBudgetOutcome(constraints.budget, estimated, evaluation_summary.total_cost, plan);

  let comparison: StrategyComparison | undefined;
  if (constraints.compare_strategies && workflow === "buyer-discovery" && !opts.followUpAction) {
    yield emitTrace("Comparing routing strategies", "Running a single-provider baseline for comparison");
    const singlePlan = buildExecutionPlan(rawTask, capabilities, workflow);
    const singleProviderId = pickSingleProviderBaseline(singlePlan, config.mode, config);
    const singleRunIterator = executeStepGraph({
      taskId: `${taskId}-single`,
      traceId,
      rawTask,
      steps: singlePlan.steps,
      resultCount: constraints.result_count ?? 15,
      mode: config.mode,
      constraints,
      config,
      singleProviderId,
    })[Symbol.asyncIterator]();
    // Comparison mode doesn't stream this baseline run's step events - only the final comparison matters.
    while (!(await singleRunIterator.next()).done) {
      // draining
    }
    const singleComposed = composeBuyerResults(singlePlan, constraints);
    const singleSummary = toStrategySummary("single", singlePlan, singleComposed.buyer_results, singleComposed.excluded_results, constraints.allow_parallel ?? true);
    const routedSummary = toStrategySummary("routed", plan, buyer_results, excluded_results, constraints.allow_parallel ?? true);
    comparison = compareStrategies(singleSummary, routedSummary);
    yield emitTrace(
      "Comparison complete",
      `Routed ${comparison.winner === "routed" ? "beat" : comparison.winner === "single" ? "lost to" : "tied"} single-provider baseline`
    );
  }

  yield emitTrace("Final result produced");

  const anyCompleted = plan.steps.some((s) => s.status === "completed");
  const status: Task["status"] = anyCompleted || buyer_results.length > 0 ? "completed" : "failed";

  const task: Task = {
    id: taskId,
    traceId,
    parentTaskId: opts.parentTaskId,
    rootTaskId,
    followUpTaskIds: [],
    followUpAction: opts.followUpAction,
    workflow,
    mode: config.mode,
    raw_task: rawTask,
    created_at: createdAt,
    completed_at: nowIso(),
    budget: constraints.budget,
    deadline_minutes: constraints.deadline_minutes,
    quality_preference: constraints.quality_preference ?? "standard",
    routing_preference: constraints.routing_preference ?? "balanced",
    result_count: constraints.result_count ?? 15,
    allow_parallel: constraints.allow_parallel ?? true,
    status,
    inferred_capabilities: capabilities,
    plan,
    buyer_results,
    excluded_results,
    final_result,
    evaluation_summary,
    execution_trace: trace,
    budget_outcome,
    comparison,
  };

  await saveTaskToHistory(task);
  if (opts.parentTaskId) {
    await linkFollowUp(opts.parentTaskId, taskId);
  }

  yield { type: "final", data: task };
  return task;
}

async function* translateStepEvent(
  stepEvent: StepEvent,
  emitTrace: (label: string, detail?: string) => PipelineEvent
): AsyncGenerator<PipelineEvent> {
  const { step, event, detail } = stepEvent;
  if (event === "started") {
    yield emitTrace(friendlyStepLabel(step));
  } else if (event === "fallback") {
    yield emitTrace(`Fallback triggered for ${step.capability.replace(/-/g, " ")}`, detail);
  } else if (event === "completed") {
    yield emitTrace(`${friendlyStepLabel(step)} - done`, `via ${step.candidates.find((c) => c.selected)?.provider_name ?? step.selectedProviderId}`);
  } else if (event === "failed") {
    yield emitTrace(`${friendlyStepLabel(step)} - failed`, detail);
  }
  yield { type: "step", data: step };
}

async function linkFollowUp(parentTaskId: string, followUpTaskId: string): Promise<void> {
  const parent = await getHistoryTask(parentTaskId);
  if (!parent) return;
  parent.followUpTaskIds = [...parent.followUpTaskIds, followUpTaskId];
  await saveTaskToHistory(parent);
}

export { buildFollowUpPlan, FOLLOW_UP_LABELS };
