import { RoutingExperiment } from "@/types";

export interface RoutingAdvantage {
  quality: number;
  evidenceCoverage: number;
  verifiedClaimRate: number;
  failedRate: number;
  sampleSize: number;
}

/**
 * Average improvement of routed execution over a single-provider baseline,
 * across every comparison-mode experiment. Previously computed independently
 * in both app/api/experiments/route.ts and app/experiments/page.tsx (with a
 * small drift - one rounded to 1 decimal, the other didn't) - consolidated
 * here so both read the same number.
 */
export function computeRoutingAdvantage(experiments: RoutingExperiment[]): RoutingAdvantage | null {
  if (experiments.length === 0) return null;
  return {
    quality: avg(experiments.map((e) => e.comparison.qualityDelta)),
    evidenceCoverage: avg(experiments.map((e) => e.comparison.evidenceCoverageDelta)),
    verifiedClaimRate: avg(experiments.map((e) => e.comparison.verifiedClaimRateDelta)),
    failedRate: avg(experiments.map((e) => e.comparison.failedRateDelta)),
    sampleSize: experiments.length,
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}
