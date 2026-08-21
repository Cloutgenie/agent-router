import { randomUUID } from "node:crypto";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { BenchmarkResult, BenchmarkRun } from "@/lib/benchmarks/runBenchmark";

const MAX_RUNS = 20;

function toRun(row: Record<string, unknown>): BenchmarkRun {
  return {
    id: row.id as string,
    ranAt: row.ran_at as string,
    results: row.results as BenchmarkResult[],
  };
}

/** Same read-only-filesystem tolerance as lib/history/store.ts - a persistence hiccup never breaks a benchmark run. Backed by Postgres (`benchmark_runs`). */
export async function saveBenchmarkRun(results: BenchmarkResult[]): Promise<BenchmarkRun> {
  const run: BenchmarkRun = { id: `bench-${randomUUID()}`, ranAt: new Date().toISOString(), results };
  if (!isSupabaseConfigured()) return run;
  try {
    const { error } = await getSupabaseClient()
      .from("benchmark_runs")
      .insert({ id: run.id, ran_at: run.ranAt, results: run.results });
    if (error) throw error;

    // Trim to the most recent MAX_RUNS, same retention cap as the file version.
    const { data: excess, error: listErr } = await getSupabaseClient()
      .from("benchmark_runs")
      .select("id")
      .order("ran_at", { ascending: false })
      .range(MAX_RUNS, MAX_RUNS + 100);
    if (listErr) throw listErr;
    if (excess && excess.length > 0) {
      await getSupabaseClient()
        .from("benchmark_runs")
        .delete()
        .in("id", excess.map((r) => r.id));
    }
  } catch (err) {
    console.warn("Could not persist benchmark run:", err);
  }
  return run;
}

export async function listBenchmarkRuns(): Promise<BenchmarkRun[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient().from("benchmark_runs").select("*").order("ran_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toRun);
}

export async function getLatestBenchmarkRun(): Promise<BenchmarkRun | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const { data, error } = await getSupabaseClient()
    .from("benchmark_runs")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toRun(data) : undefined;
}
