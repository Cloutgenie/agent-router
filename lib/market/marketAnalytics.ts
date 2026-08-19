import { trustTierFromJobCount } from "@/lib/router/marketUtility";
import {
  AgentProvider,
  Capability,
  ExecutionQuote,
  ProviderOverride,
  ProviderPerformanceMetrics,
  Task,
  TrustTier,
} from "@/types";

/**
 * Market dashboards (V7 #16-24, #58): every function here is a pure,
 * read-only aggregation over data the app already persists (task history,
 * execution quotes, performance metrics, the provider registry) - no new
 * write path, no new store. Callers (the /market, /supply, /demand pages)
 * fetch the raw data and pass it in, which keeps this module trivially
 * unit-testable with plain fixtures instead of mocked file I/O.
 */

export interface CapabilityDemandStats {
  capability: Capability;
  taskCount: number;
  stepCount: number;
  completedCount: number;
  /** Steps that failed with zero eligible candidates - "no eligible executor found" (V7 #19), not an execution failure. */
  unmetCount: number;
  successRate: number;
  avgCost: number;
  avgLatencySeconds: number;
  activeExecutorCount: number;
}

export function computeCapabilityDemand(tasks: Task[]): CapabilityDemandStats[] {
  interface Bucket {
    taskIds: Set<string>;
    stepCount: number;
    completedCount: number;
    unmetCount: number;
    costSum: number;
    latencySum: number;
    executors: Set<string>;
  }
  const byCapability = new Map<Capability, Bucket>();

  for (const task of tasks) {
    for (const step of task.plan.steps) {
      const bucket: Bucket = byCapability.get(step.capability) ?? {
        taskIds: new Set(),
        stepCount: 0,
        completedCount: 0,
        unmetCount: 0,
        costSum: 0,
        latencySum: 0,
        executors: new Set(),
      };
      bucket.taskIds.add(task.id);
      bucket.stepCount += 1;
      if (step.status === "completed") {
        bucket.completedCount += 1;
        if (step.result) {
          bucket.costSum += step.result.cost;
          bucket.latencySum += step.result.duration_seconds;
        }
        if (step.selectedProviderId) bucket.executors.add(step.selectedProviderId);
      }
      if (step.status === "failed" && step.candidates.length === 0) bucket.unmetCount += 1;
      byCapability.set(step.capability, bucket);
    }
  }

  return Array.from(byCapability.entries())
    .map(([capability, b]) => ({
      capability,
      taskCount: b.taskIds.size,
      stepCount: b.stepCount,
      completedCount: b.completedCount,
      unmetCount: b.unmetCount,
      successRate: b.stepCount > 0 ? round2(b.completedCount / b.stepCount) : 0,
      avgCost: b.completedCount > 0 ? round2(b.costSum / b.completedCount) : 0,
      avgLatencySeconds: b.completedCount > 0 ? round2(b.latencySum / b.completedCount) : 0,
      activeExecutorCount: b.executors.size,
    }))
    .sort((a, b) => b.stepCount - a.stepCount);
}

export interface ExecutorSupplyStats {
  executorId: string;
  executorName: string;
  capabilities: Capability[];
  configured: boolean;
  /** Trust tier aggregated across every capability this executor has ever run - distinct from the per-capability tier shown in routing transparency. */
  trustTier: TrustTier;
  timesEligible: number;
  jobsCompleted: number;
  winRate: number;
  avgPrice: number;
  /** jobsCompleted * avgPrice - "if this were billed," not a real revenue figure. */
  revenueOpportunity: number;
}

export function computeExecutorSupply(
  tasks: Task[],
  providers: AgentProvider[],
  overrides: Record<string, ProviderOverride>
): ExecutorSupplyStats[] {
  interface Bucket {
    timesEligible: number;
    jobsCompleted: number;
    costSum: number;
  }
  const stats = new Map<string, Bucket>();
  for (const provider of providers) stats.set(provider.id, { timesEligible: 0, jobsCompleted: 0, costSum: 0 });

  for (const task of tasks) {
    for (const step of task.plan.steps) {
      for (const candidate of step.candidates) {
        const bucket = stats.get(candidate.provider_id);
        if (bucket) bucket.timesEligible += 1; // skip candidates for a provider since removed from the registry
      }
      if (step.status === "completed" && step.selectedProviderId) {
        const bucket = stats.get(step.selectedProviderId);
        if (bucket) {
          bucket.jobsCompleted += 1;
          if (step.result) bucket.costSum += step.result.cost;
        }
      }
    }
  }

  return providers.map((provider) => {
    const b = stats.get(provider.id)!;
    const avgPrice = b.jobsCompleted > 0 ? round2(b.costSum / b.jobsCompleted) : provider.price_per_task;
    return {
      executorId: provider.id,
      executorName: provider.name,
      capabilities: provider.capabilities,
      configured: provider.configured,
      trustTier: trustTierFromJobCount(b.jobsCompleted, overrides[provider.id]),
      timesEligible: b.timesEligible,
      jobsCompleted: b.jobsCompleted,
      winRate: b.timesEligible > 0 ? round2(b.jobsCompleted / b.timesEligible) : 0,
      avgPrice,
      revenueOpportunity: round2(b.jobsCompleted * avgPrice),
    };
  });
}

export interface MarketGap {
  capability: Capability;
  demandVolume: number;
  activeExecutorCount: number;
  avgCost: number;
  failureRate: number;
  severity: "low" | "medium" | "high";
}

const SEVERITY_RANK: Record<MarketGap["severity"], number> = { high: 2, medium: 1, low: 0 };

/**
 * Deliberately does not factor in demand *growth* (the spec's own worked
 * example does) - with the small task volumes a local prototype actually
 * accumulates, a growth percentage computed from a handful of timestamps
 * would be noise dressed up as a trend. Severity here rests on the two
 * robust signals available at any volume: how much supply exists, and how
 * often it fails.
 */
export function computeMarketGaps(demand: CapabilityDemandStats[]): MarketGap[] {
  return demand
    .filter((d) => d.stepCount > 0)
    .map((d) => {
      const failureRate = round2(1 - d.successRate);
      let severity: MarketGap["severity"] = "low";
      if (d.activeExecutorCount <= 1 || failureRate >= 0.5) severity = "high";
      else if (d.activeExecutorCount <= 2 || failureRate >= 0.25) severity = "medium";
      return {
        capability: d.capability,
        demandVolume: d.stepCount,
        activeExecutorCount: d.activeExecutorCount,
        avgCost: d.avgCost,
        failureRate,
        severity,
      };
    })
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.demandVolume - a.demandVolume);
}

export interface ExecutionAlphaSummary {
  /** Number of steps that had genuine competition (2+ quotes) to compare the winner against. */
  sampleSize: number;
  qualityLift: number;
  costReduction: number;
  latencyReductionMs: number;
  reliabilityLift: number;
}

/**
 * "How much value did executor selection itself create, compared with the
 * other executors that were actually available for that step" (V7 #22) -
 * deliberately distinct from Routing Advantage, which compares against a
 * single-provider full-pipeline baseline instead (lib/history/
 * routingAdvantage.ts). Built entirely from ExecutionQuote records, so
 * verification-rate and failure-rate lift aren't included: quotes don't
 * carry a verification estimate (matching the market-core batch's decision
 * to keep ExecutionQuote's shape minimal), and failure-rate would need a
 * different data source - deferred, not fabricated.
 */
export function computeExecutionAlpha(tasks: Task[], quotes: ExecutionQuote[]): ExecutionAlphaSummary {
  const quotesByStep = new Map<string, ExecutionQuote[]>();
  for (const quote of quotes) {
    const key = `${quote.taskId}::${quote.stepId}`;
    const list = quotesByStep.get(key) ?? [];
    list.push(quote);
    quotesByStep.set(key, list);
  }

  const qualityLifts: number[] = [];
  const costReductions: number[] = [];
  const latencyReductions: number[] = [];
  const reliabilityLifts: number[] = [];

  for (const task of tasks) {
    for (const step of task.plan.steps) {
      if (!step.selectedProviderId) continue;
      const stepQuotes = quotesByStep.get(`${task.id}::${step.id}`) ?? [];
      if (stepQuotes.length < 2) continue; // no real competition to measure alpha against
      const selected = stepQuotes.find((q) => q.executorId === step.selectedProviderId);
      if (!selected) continue;

      qualityLifts.push(selected.qualityEstimate - median(stepQuotes.map((q) => q.qualityEstimate)));
      costReductions.push(median(stepQuotes.map((q) => q.priceEstimate)) - selected.priceEstimate);
      latencyReductions.push(median(stepQuotes.map((q) => q.latencyEstimateMs)) - selected.latencyEstimateMs);
      reliabilityLifts.push(selected.reliabilityEstimate - median(stepQuotes.map((q) => q.reliabilityEstimate)));
    }
  }

  return {
    sampleSize: qualityLifts.length,
    qualityLift: round2(avg(qualityLifts)),
    costReduction: round2(avg(costReductions)),
    latencyReductionMs: Math.round(avg(latencyReductions)),
    reliabilityLift: round2(avg(reliabilityLifts)),
  };
}

export interface MarketOverview {
  activeExecutorCount: number;
  capabilityCount: number;
  executionVolume: number;
  verifiedOutcomeRate: number;
  unmetDemandCount: number;
  averageCost: number;
}

export function computeMarketOverview(
  tasks: Task[],
  demand: CapabilityDemandStats[],
  providers: AgentProvider[],
  performanceMetrics: ProviderPerformanceMetrics[]
): MarketOverview {
  const verificationTotalSum = performanceMetrics.reduce((s, m) => s + m.verification_total, 0);
  const verificationPassSum = performanceMetrics.reduce((s, m) => s + m.verification_pass_count, 0);
  const completedTasks = tasks.filter((t) => t.status === "completed");

  return {
    activeExecutorCount: providers.filter((p) => p.configured).length,
    capabilityCount: demand.filter((d) => d.stepCount > 0).length,
    executionVolume: demand.reduce((s, d) => s + d.completedCount, 0),
    verifiedOutcomeRate: verificationTotalSum > 0 ? round2(verificationPassSum / verificationTotalSum) : 0,
    unmetDemandCount: demand.reduce((s, d) => s + d.unmetCount, 0),
    averageCost:
      completedTasks.length > 0
        ? round2(completedTasks.reduce((s, t) => s + t.evaluation_summary.total_cost, 0) / completedTasks.length)
        : 0,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(values: number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
