import { BENCHMARK_SCENARIOS, BenchmarkDifficulty, BenchmarkScenario } from "@/data/benchmark-scenarios";
import { runTaskPipeline } from "@/lib/pipeline";
import { EvaluationSummary, StrategyComparison, Task } from "@/types";

export interface BenchmarkResult {
  scenarioId: string;
  scenarioName: string;
  difficulty: BenchmarkDifficulty;
  taskId: string;
  traceId: string;
  comparison?: StrategyComparison;
  evaluation: EvaluationSummary;
}

export interface BenchmarkRun {
  id: string;
  ranAt: string;
  results: BenchmarkResult[];
}

function resultCountFor(goal: string): number {
  const match = goal.match(/\d+/);
  return match ? Math.min(20, Math.max(1, Number(match[0]))) : 5;
}

/**
 * Runs one gold scenario through the full pipeline with comparison mode on
 * (spec #48): the existing single-provider-baseline vs. routed-execution
 * comparison (`StrategyComparison`, already exercised by "Compare routing
 * strategy" on the Execute page) is what actually gets measured here - see
 * data/benchmark-scenarios.ts for why this dataset varies the goal/depth
 * rather than swapping in a bespoke fixture per scenario.
 */
export async function runBenchmarkScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
  let finalTask: Task | undefined;

  for await (const event of runTaskPipeline({
    rawTask: scenario.goal,
    constraints: {
      result_count: resultCountFor(scenario.goal),
      compare_strategies: true,
      allow_parallel: true,
      quality_preference: "standard",
      routing_preference: "balanced",
    },
  })) {
    if (event.type === "final") finalTask = event.data;
  }

  if (!finalTask) throw new Error(`Benchmark scenario ${scenario.id} produced no final result`);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    difficulty: scenario.difficulty,
    taskId: finalTask.id,
    traceId: finalTask.traceId,
    comparison: finalTask.comparison,
    evaluation: finalTask.evaluation_summary,
  };
}

/** Runs every gold scenario concurrently - each is a handful of mocked, artificially-short calls, so 20 in parallel is still fast. */
export async function runAllBenchmarks(): Promise<BenchmarkResult[]> {
  return Promise.all(BENCHMARK_SCENARIOS.map(runBenchmarkScenario));
}
