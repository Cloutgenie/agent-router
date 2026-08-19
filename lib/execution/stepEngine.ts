import { RuntimeConfig } from "@/lib/config";
import { recordProviderAttempt } from "@/lib/history/performanceStore";
import { recordQuotes } from "@/lib/market/quoteStore";
import { evaluateApproval } from "@/lib/policy/executionPolicy";
import { beginRun, endRun, isAtConcurrencyLimit } from "@/lib/providers/concurrencyTracker";
import { getCachedOverrides } from "@/lib/providers/overrideStore";
import { getEligibleProviders, getProviderById } from "@/lib/providers/registry";
import { routeStep } from "@/lib/router/providerRouter";
import { getAllPerformanceMetrics } from "@/lib/history/performanceStore";
import {
  AgentProvider,
  ExecutionMode,
  ExecutionStep,
  ProviderOverride,
  ProviderPerformanceMetrics,
  ProviderResult,
  ProviderTask,
  TaskConstraints,
} from "@/types";

export interface StepEvent {
  step: ExecutionStep;
  event: "started" | "completed" | "failed" | "fallback" | "blocked";
  detail?: string;
}

const DEFAULT_PROVIDER_TIMEOUT_MS = Number(process.env.DEFAULT_EXECUTION_TIMEOUT_MS ?? 30000);

/**
 * Per-task run cap (spec #35's maxRunsPerTask). Only meaningful at routing
 * time, when deciding which provider a step *should* use - re-applying it
 * at execution time would incorrectly exclude a step's own just-made
 * reservation (its count already includes itself).
 */
function filterByTaskRunCap(
  providers: AgentProvider[],
  overrides: Record<string, ProviderOverride>,
  taskRunCounts: Map<string, number>
): AgentProvider[] {
  return providers.filter((provider) => {
    const cap = overrides[provider.id]?.maxRunsPerTask;
    if (cap == null) return true;
    return (taskRunCounts.get(provider.id) ?? 0) < cap;
  });
}

/** Process-wide concurrency cap (spec #35's maxConcurrentRuns) - genuinely dynamic, so it's re-checked at both routing and execution time. */
function filterByConcurrency(providers: AgentProvider[], overrides: Record<string, ProviderOverride>): AgentProvider[] {
  return providers.filter((provider) => !isAtConcurrencyLimit(provider.id, overrides[provider.id]?.maxConcurrentRuns));
}

class ProviderTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderTimeoutError(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Minimal async push-queue so concurrent step events can be yielded as they happen, not batched at wave-end. */
function createEventQueue<T>() {
  const buffered: T[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  function push(item: T) {
    buffered.push(item);
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  }

  function finish() {
    finished = true;
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  }

  async function* iterate(): AsyncGenerator<T> {
    while (true) {
      if (buffered.length > 0) {
        yield buffered.shift() as T;
        continue;
      }
      if (finished) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  return { push, finish, iterate };
}

/** Upstream step id -> the context key its output is exposed under for dependent steps. */
const CONTEXT_KEY_FOR_STEP: Record<string, string> = {
  discover: "companies",
  funding: "fundingByCompany",
  "ai-signal": "aiByCompany",
  hiring: "hiringByCompany",
  contact: "contactByCompany",
  "browser-verify": "browserByCompany",
  validate: "validationByCompany",
};

function buildContext(step: ExecutionStep, steps: ExecutionStep[]): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const depId of step.dependencies) {
    const dep = steps.find((s) => s.id === depId);
    if (!dep?.result || dep.status !== "completed") continue;
    const keyName = CONTEXT_KEY_FOR_STEP[depId];
    if (!keyName) continue;
    if (keyName === "companies") {
      context.companies = dep.result.data.companies;
    } else {
      context[keyName] = dep.result.data.byCompany;
    }
  }
  return { ...context, ...step.extraContext };
}

const TERMINAL_STEP_STATUSES = ["completed", "failed", "awaiting_approval"];

function readyStatus(steps: ExecutionStep[], step: ExecutionStep): boolean {
  if (step.status !== "pending") return false;
  return step.dependencies.every((depId) => {
    const dep = steps.find((s) => s.id === depId);
    return dep && TERMINAL_STEP_STATUSES.includes(dep.status);
  });
}

/** One timed, concurrency-tracked call to a single provider - no fallback logic here, just the mechanics of one attempt. */
async function attemptOnce(provider: AgentProvider, providerTask: ProviderTask, timeoutMs: number): Promise<ProviderResult> {
  beginRun(provider.id);
  try {
    return await withTimeout(provider.execute(providerTask), timeoutMs);
  } catch (err) {
    const timedOut = err instanceof ProviderTimeoutError;
    return {
      status: "failed",
      data: {},
      evidence: [],
      confidence: 0,
      cost: 0,
      duration_seconds: timedOut ? timeoutMs / 1000 : 0,
      error: err instanceof Error ? err.message : "Unknown provider error",
    };
  } finally {
    endRun(provider.id);
  }
}

async function runStepWithFallback(
  step: ExecutionStep,
  providers: AgentProvider[],
  providerTask: ProviderTask,
  overrides: Record<string, ProviderOverride>,
  yieldEvent: (event: StepEvent) => void
): Promise<void> {
  let attemptOrder = [step.selectedProviderId, ...step.fallbackProviderIds].filter(
    (id): id is string => Boolean(id)
  );
  // Cap total distinct candidates (primary + up to 2 fallbacks) so a fully-down market fails fast.
  attemptOrder = attemptOrder.slice(0, 3);

  for (let i = 0; i < attemptOrder.length; i++) {
    const provider = providers.find((p) => p.id === attemptOrder[i]);
    if (!provider) continue;

    if (i > 0) {
      step.usedFallback = true;
      yieldEvent({ step, event: "fallback", detail: `Falling back to ${provider.name}` });
    }

    const override = overrides[provider.id];
    const timeoutMs = override?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    // Same-provider retry (spec #35's maxRetries) before moving to the next distinct candidate - clamped so a misconfigured override can't loop indefinitely.
    const maxAttempts = Math.min(5, Math.max(1, override?.maxRetries ?? 1));

    let result: ProviderResult = {
      status: "failed",
      data: {},
      evidence: [],
      confidence: 0,
      cost: 0,
      duration_seconds: 0,
      error: "Never attempted.",
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (isAtConcurrencyLimit(provider.id, override?.maxConcurrentRuns)) {
        result = {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: `${provider.name} is at its concurrency limit (${override?.maxConcurrentRuns}) right now.`,
        };
        break; // no point retrying the same saturated provider - move to the next candidate
      }

      result = await attemptOnce(provider, providerTask, timeoutMs);

      await recordProviderAttempt({
        provider_id: provider.id,
        capability: step.capability,
        succeeded: result.status === "completed",
        confidence: result.confidence,
        latency_seconds: result.duration_seconds,
        cost: result.cost,
      });

      if (result.status === "completed") {
        step.result = result;
        step.selectedProviderId = provider.id;
        step.status = "completed";
        yieldEvent({ step, event: "completed" });
        return;
      }

      if (attempt < maxAttempts - 1) {
        yieldEvent({ step, event: "fallback", detail: `Retrying ${provider.name} (attempt ${attempt + 2} of ${maxAttempts})` });
      }
    }
  }

  step.status = "failed";
  step.result = {
    status: "failed",
    data: {},
    evidence: [],
    confidence: 0,
    cost: 0,
    duration_seconds: 0,
    error: "All candidate providers failed for this step.",
  };
  yieldEvent({ step, event: "failed", detail: step.result.error });
}

export interface ExecuteStepGraphOptions {
  taskId: string;
  traceId: string;
  rawTask: string;
  steps: ExecutionStep[];
  resultCount: number;
  mode: ExecutionMode;
  constraints: TaskConstraints;
  config: RuntimeConfig;
  /**
   * Comparison mode (V4 #12): restrict every step to exactly one provider
   * (when it's eligible for that step's capability). Steps the provider
   * cannot perform simply fail - which is the point: it demonstrates what a
   * single generalist provider cannot cover on its own.
   */
  singleProviderId?: string;
}

function restrictToSingleProvider(
  providers: AgentProvider[],
  singleProviderId: string | undefined
): AgentProvider[] {
  if (!singleProviderId) return providers;
  return providers.filter((p) => p.id === singleProviderId);
}

/**
 * Execution engine: walks the dependency graph, running every step whose
 * dependencies are satisfied. Independent steps within the same "wave" run
 * concurrently (`Promise.all`-style) unless the caller disabled parallelism.
 * A failed primary provider falls back to the next-ranked candidate rather
 * than failing the whole step.
 */
export async function* executeStepGraph(opts: ExecuteStepGraphOptions): AsyncGenerator<StepEvent> {
  const { taskId, traceId, rawTask, steps, resultCount, mode, constraints, config, singleProviderId } = opts;
  const allMetrics = await getAllPerformanceMetrics();
  const metricsByCapability = new Map<string, ProviderPerformanceMetrics[]>();
  for (const m of allMetrics) {
    const list = metricsByCapability.get(m.capability) ?? [];
    list.push(m);
    metricsByCapability.set(m.capability, list);
  }

  const overrides = getCachedOverrides();
  /** How many steps in THIS task have already been assigned to each provider - spec #35's per-task run cap. */
  const taskProviderRunCounts = new Map<string, number>();

  let spent = 0;

  while (steps.some((s) => s.status === "pending" || s.status === "running")) {
    const ready = steps.filter((s) => readyStatus(steps, s));
    if (ready.length === 0) break;

    const blockedEvents: StepEvent[] = [];
    const runnable: ExecutionStep[] = [];

    for (const step of ready) {
      // Approval gate (spec #10, #26, #28): a step above READ_ONLY risk is
      // never routed to a provider - scored, selected, or executed - unless
      // its capability was explicitly pre-approved for this task.
      step.approval = evaluateApproval(step.capability, constraints.approved_actions);
      if (step.approval.status === "pending") {
        step.status = "awaiting_approval";
        step.result = {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: step.approval.reason,
        };
        blockedEvents.push({ step, event: "blocked", detail: step.approval.reason });
        continue;
      }

      const eligible = restrictToSingleProvider(getEligibleProviders(step.capability, mode, config), singleProviderId);
      const providers = filterByConcurrency(filterByTaskRunCap(eligible, overrides, taskProviderRunCounts), overrides);
      const perfForCapability = metricsByCapability.get(step.capability) ?? [];
      const perfMap = new Map(perfForCapability.map((m) => [m.provider_id, m]));
      const budgetRemaining = constraints.budget != null ? Math.max(0, constraints.budget - spent) : undefined;

      const routed = routeStep({
        providers,
        capability: step.capability,
        constraints,
        performance: perfMap,
        explorationRate: config.explorationRate,
        budgetRemaining,
      });

      step.candidates = routed.candidates;
      step.selectedProviderId = routed.selectedProviderId;
      step.fallbackProviderIds = routed.fallbackProviderIds;
      step.status = "running";
      runnable.push(step);

      await recordQuotes(taskId, step.id, routed.offers);

      if (routed.selectedProviderId) {
        const provider = providers.find((p) => p.id === routed.selectedProviderId);
        spent += provider?.price_per_task ?? 0;
        taskProviderRunCounts.set(routed.selectedProviderId, (taskProviderRunCounts.get(routed.selectedProviderId) ?? 0) + 1);
      }
    }

    for (const event of blockedEvents) yield event;

    const queue = createEventQueue<StepEvent>();
    const runOne = async (step: ExecutionStep, emit: (event: StepEvent) => void) => {
      const eligible = restrictToSingleProvider(getEligibleProviders(step.capability, mode, config), singleProviderId);
      // Only concurrency is re-checked here, not the per-task run cap - that
      // cap already decided step.selectedProviderId/fallbackProviderIds at
      // routing time, using this same step's own reservation. Re-applying it
      // here would incorrectly exclude a step's own selection.
      const providers = filterByConcurrency(eligible, overrides);
      if (!step.selectedProviderId || providers.length === 0) {
        step.status = "failed";
        step.result = {
          status: "failed",
          data: {},
          evidence: [],
          confidence: 0,
          cost: 0,
          duration_seconds: 0,
          error: "No eligible provider was available for this capability.",
        };
        emit({ step, event: "failed", detail: step.result.error });
        return;
      }

      emit({ step, event: "started" });
      const providerTask: ProviderTask = {
        taskId,
        traceId,
        stepId: step.id,
        capability: step.capability,
        goal: rawTask,
        context: buildContext(step, steps),
        resultCount,
        budgetRemaining: constraints.budget,
      };

      await runStepWithFallback(step, providers, providerTask, overrides, emit);
    };

    if (constraints.allow_parallel === false) {
      for (const step of runnable) {
        const events: StepEvent[] = [];
        await runOne(step, (e) => events.push(e));
        for (const event of events) yield event;
      }
    } else {
      const runAll = Promise.all(runnable.map((step) => runOne(step, queue.push))).then(() => queue.finish());
      yield* queue.iterate();
      await runAll;
    }
  }

  // Any step that never became ready (circular or unmet dependency) is marked failed.
  for (const step of steps) {
    if (step.status === "pending") {
      step.status = "failed";
      step.result = {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: 0,
        duration_seconds: 0,
        error: "Step dependencies were never satisfied.",
      };
      yield { step, event: "failed", detail: step.result.error };
    }
  }
}

export function getProviderNameSafe(providerId: string | undefined, config: RuntimeConfig): string {
  if (!providerId) return "Unknown";
  return getProviderById(providerId, config)?.name ?? providerId;
}
