import { ModeBadge } from "@/components/ModeBadge";
import { BenchmarksClient } from "@/components/BenchmarksClient";
import { BENCHMARK_SCENARIOS } from "@/data/benchmark-scenarios";
import { getLatestBenchmarkRun } from "@/lib/history/benchmarkStore";

export const dynamic = "force-dynamic";

export default async function BenchmarksPage() {
  const latestRun = await getLatestBenchmarkRun();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <ModeBadge />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Benchmarks</h1>
        <p className="mt-1 text-sm text-muted">
          {BENCHMARK_SCENARIOS.length} gold scenarios - 5 easy, 5 medium, 5 sparse-evidence, 5 conflicting-evidence -
          proving whether routed execution actually beats a single-provider baseline, not just on the flagship demo.
        </p>
      </div>

      <BenchmarksClient scenarios={BENCHMARK_SCENARIOS} initialRun={latestRun ?? null} />
    </div>
  );
}
