import { listExperiments } from "@/lib/history/store";

export const dynamic = "force-dynamic";

/** Routing experiments (V4 #13) - every task run with "Compare routing strategy" on. */
export async function GET() {
  const experiments = await listExperiments();

  const routingAdvantage =
    experiments.length > 0
      ? {
          quality: avg(experiments.map((e) => e.comparison.qualityDelta)),
          evidenceCoverage: avg(experiments.map((e) => e.comparison.evidenceCoverageDelta)),
          verifiedClaimRate: avg(experiments.map((e) => e.comparison.verifiedClaimRateDelta)),
          failedRate: avg(experiments.map((e) => e.comparison.failedRateDelta)),
          sampleSize: experiments.length,
        }
      : null;

  return Response.json({ experiments, routing_advantage: routingAdvantage });
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}
