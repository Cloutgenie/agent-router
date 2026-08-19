import { BENCHMARK_SCENARIOS } from "@/data/benchmark-scenarios";
import { listBenchmarkRuns } from "@/lib/history/benchmarkStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await listBenchmarkRuns();
  return Response.json({ scenarios: BENCHMARK_SCENARIOS, runs });
}
