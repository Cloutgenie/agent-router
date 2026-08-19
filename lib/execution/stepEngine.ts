import { RuntimeConfig } from "@/lib/config";
import { recordProviderAttempt } from "@/lib/history/performanceStore";
import { getEligibleProviders, getProviderById } from "@/lib/providers/registry";
import { routeStep } from "@/lib/router/providerRouter";
import { getAllPerformanceMetrics } from "@/lib/history/performanceStore";
import {
  AgentProvider,
  ExecutionMode,
  ExecutionStep,
  ProviderPerformanceMetrics,
  ProviderResult,
  ProviderTask,
  TaskConstraints,
} from "@/types";

export interface StepEvent {
  step: ExecutionStep;
  event: "started" | "completed" | "failed" | "fallback";
  detail?: string;
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

function readyStatus(steps: ExecutionStep[], step: ExecutionStep): boolean {
  if (step.status !== "pending") return false;
  return step.dependencies.every((depId) => {
    const dep = steps.find((s) => s.id === depId);
    return dep && (dep.status === "completed" || dep.status === "failed");
  });
}

async function runStepWithFallback(
  step: ExecutionStep,
  providers: AgentProvider[],
  providerTask: ProviderTask,
  yieldEvent: (event: StepEvent) => void
): Promise<void> {
  let attemptOrder = [step.selectedProviderId, ...step.fallbackProviderIds].filter(
    (id): id is string => Boolean(id)
  );
  // Cap total attempts (primary + up to 2 fallbacks) so a fully-down market fails fast.
  attemptOrder = attemptOrder.slice(0, 3);

  for (let i = 0; i < attemptOrder.length; i++) {
    const provider = providers.find((p) => p.id === attemptOrder[i]);
    if (!provider) continue;

    if (i > 0) {
      step.usedFallback = true;
      yieldEvent({ step, event: "fallback", detail: `Falling back to ${provider.name}` });
    }

    let result: ProviderResult;
    try {
      result = await provider.execute(providerTask);
    } catch (err) {
      result = {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: 0,
        duration_seconds: 0,
        error: err instanceof Error ? err.message : "Unknown provider error",
      };
    }

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

  let spent = 0;

  while (steps.some((s) => s.status === "pending" || s.status === "running")) {
    const ready = steps.filter((s) => readyStatus(steps, s));
    if (ready.length === 0) break;

    for (const step of ready) {
      const providers = restrictToSingleProvider(getEligibleProviders(step.capability, mode, config), singleProviderId);
      const perfForCapability = metricsByCapability.get(step.capability) ?? [];
      const perfMap = new Map(perfForCapability.map((m) => [m.provider_id, m]));
      const budgetRemaining = constraints.budget != null ? Math.max(0, constraints.budget - spent) : undefined;

      const routed = routeStep({
        providers,
        constraints,
        performance: perfMap,
        explorationRate: config.explorationRate,
        budgetRemaining,
      });

      step.candidates = routed.candidates;
      step.selectedProviderId = routed.selectedProviderId;
      step.fallbackProviderIds = routed.fallbackProviderIds;
      step.status = "running";

      if (routed.selectedProviderId) {
        const provider = providers.find((p) => p.id === routed.selectedProviderId);
        spent += provider?.price_per_task ?? 0;
      }
    }

    const queue = createEventQueue<StepEvent>();
    const runOne = async (step: ExecutionStep, emit: (event: StepEvent) => void) => {
      const providers = restrictToSingleProvider(getEligibleProviders(step.capability, mode, config), singleProviderId);
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

      await runStepWithFallback(step, providers, providerTask, emit);
    };

    if (constraints.allow_parallel === false) {
      for (const step of ready) {
        const events: StepEvent[] = [];
        await runOne(step, (e) => events.push(e));
        for (const event of events) yield event;
      }
    } else {
      const runAll = Promise.all(ready.map((step) => runOne(step, queue.push))).then(() => queue.finish());
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
