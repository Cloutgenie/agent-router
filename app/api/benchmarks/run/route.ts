import { runAllBenchmarks } from "@/lib/benchmarks/runBenchmark";
import { saveBenchmarkRun } from "@/lib/history/benchmarkStore";

export const dynamic = "force-dynamic";

export async function POST() {
  const results = await runAllBenchmarks();
  const run = await saveBenchmarkRun(results);
  return Response.json(run);
}
