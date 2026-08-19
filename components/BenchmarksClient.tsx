"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BenchmarkDifficulty, BenchmarkScenario } from "@/data/benchmark-scenarios";
import { BenchmarkRun } from "@/lib/benchmarks/runBenchmark";
import { StatTileRow } from "@/components/StatTiles";

const DIFFICULTY_LABEL: Record<BenchmarkDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  "sparse-evidence": "Sparse evidence",
  "conflicting-evidence": "Conflicting evidence",
};

const DIFFICULTY_ORDER: BenchmarkDifficulty[] = ["easy", "medium", "sparse-evidence", "conflicting-evidence"];

function winnerBadge(winner: "single" | "routed" | "tie" | undefined) {
  if (!winner) return <span className="text-[11px] text-muted-dim">not applicable</span>;
  const style =
    winner === "routed"
      ? "border-good/30 bg-good-soft text-good"
      : winner === "single"
        ? "border-bad/30 bg-bad-soft text-bad"
        : "border-border bg-surface text-muted";
  const label = winner === "routed" ? "Routed won" : winner === "single" ? "Baseline won" : "Tie";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}>{label}</span>;
}

export function BenchmarksClient({
  scenarios,
  initialRun,
}: {
  scenarios: BenchmarkScenario[];
  initialRun: BenchmarkRun | null;
}) {
  const [run, setRun] = useState<BenchmarkRun | null>(initialRun);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRunAll() {
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/benchmarks/run", { method: "POST" });
      if (!res.ok) throw new Error(`Benchmark run failed (${res.status})`);
      const data = (await res.json()) as BenchmarkRun;
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Benchmark run failed");
    } finally {
      setIsRunning(false);
    }
  }

  const resultByScenario = useMemo(() => {
    const map = new Map<string, BenchmarkRun["results"][number]>();
    run?.results.forEach((r) => map.set(r.scenarioId, r));
    return map;
  }, [run]);

  const aggregate = useMemo(() => {
    const applicable = (run?.results ?? []).filter((r) => r.comparison);
    const routedWins = applicable.filter((r) => r.comparison!.winner === "routed").length;
    const ties = applicable.filter((r) => r.comparison!.winner === "tie").length;
    const baselineWins = applicable.filter((r) => r.comparison!.winner === "single").length;
    const avgQualityDelta = applicable.length > 0 ? average(applicable.map((r) => r.comparison!.qualityDelta)) : 0;
    const avgEvidenceDelta =
      applicable.length > 0 ? average(applicable.map((r) => r.comparison!.evidenceCoverageDelta)) : 0;
    const avgVerifiedDelta =
      applicable.length > 0 ? average(applicable.map((r) => r.comparison!.verifiedClaimRateDelta)) : 0;
    return { applicable: applicable.length, routedWins, ties, baselineWins, avgQualityDelta, avgEvidenceDelta, avgVerifiedDelta };
  }, [run]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Every scenario runs with comparison mode on: a single-provider baseline against the full routed
          execution (the same <code className="text-[12px]">StrategyComparison</code> the Execute page and{" "}
          <Link href="/experiments" className="underline decoration-dotted hover:text-foreground">
            Experiments
          </Link>{" "}
          use). Scenarios that aren&apos;t buyer-discovery goals don&apos;t produce a comparison - shown as N/A.
        </p>
        <button
          type="button"
          onClick={handleRunAll}
          disabled={isRunning}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
              Running 20 scenarios...
            </>
          ) : (
            "Run all benchmarks"
          )}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-bad">{error}</p>}

      {run && (
        <div className="mb-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">
            Last run · {new Date(run.ranAt).toLocaleString()}
          </div>
          <StatTileRow
            tiles={[
              { label: "Routed won", value: `${aggregate.routedWins}/${aggregate.applicable}` },
              { label: "Tie", value: String(aggregate.ties) },
              { label: "Baseline won", value: String(aggregate.baselineWins) },
              { label: "Avg. quality delta", value: signed(Math.round(aggregate.avgQualityDelta)) },
              { label: "Avg. evidence coverage delta", value: signed(Math.round(aggregate.avgEvidenceDelta * 100)) + "%" },
              { label: "Avg. verified-claim delta", value: signed(Math.round(aggregate.avgVerifiedDelta * 100)) + "%" },
            ]}
          />
        </div>
      )}

      {DIFFICULTY_ORDER.map((difficulty) => (
        <div key={difficulty} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground">{DIFFICULTY_LABEL[difficulty]}</h2>
          <div className="card divide-y divide-border overflow-hidden">
            {scenarios
              .filter((s) => s.difficulty === difficulty)
              .map((scenario) => {
                const result = resultByScenario.get(scenario.id);
                return (
                  <div key={scenario.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{scenario.name}</span>
                        {result && (
                          <Link
                            href={`/traces/${result.traceId}`}
                            className="text-[11px] text-muted-dim underline decoration-dotted hover:text-foreground"
                          >
                            trace
                          </Link>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted-dim">{scenario.note}</p>
                    </div>
                    <div className="shrink-0">{result ? winnerBadge(result.comparison?.winner) : <span className="text-[11px] text-muted-dim">not yet run</span>}</div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}
