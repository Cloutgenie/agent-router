import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BenchmarkResult, BenchmarkRun } from "@/lib/benchmarks/runBenchmark";

const BENCHMARKS_PATH = path.join(process.cwd(), "data", "benchmark-runs.json");
const MAX_RUNS = 20;

async function readAll(): Promise<BenchmarkRun[]> {
  try {
    const raw = await fs.readFile(BENCHMARKS_PATH, "utf-8");
    return JSON.parse(raw) as BenchmarkRun[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Same read-only-filesystem tolerance as lib/history/store.ts - a persistence hiccup never breaks a benchmark run. */
export async function saveBenchmarkRun(results: BenchmarkResult[]): Promise<BenchmarkRun> {
  const run: BenchmarkRun = { id: `bench-${randomUUID()}`, ranAt: new Date().toISOString(), results };
  try {
    const runs = await readAll();
    runs.unshift(run);
    await fs.writeFile(BENCHMARKS_PATH, JSON.stringify(runs.slice(0, MAX_RUNS), null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not persist benchmark run:", err);
  }
  return run;
}

export async function listBenchmarkRuns(): Promise<BenchmarkRun[]> {
  return readAll();
}

export async function getLatestBenchmarkRun(): Promise<BenchmarkRun | undefined> {
  const runs = await readAll();
  return runs[0];
}
