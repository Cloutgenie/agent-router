import fs from "node:fs/promises";
import path from "node:path";
import { actualProviderName } from "@/lib/providerLabel";
import { RoutingExperiment, Task, TaskHistoryEntry } from "@/types";

const HISTORY_PATH = path.join(process.cwd(), "data", "history.json");
const MAX_HISTORY = 200;

async function readAll(): Promise<Task[]> {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw) as Task[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(tasks: Task[]): Promise<void> {
  await fs.writeFile(HISTORY_PATH, JSON.stringify(tasks, null, 2), "utf-8");
}

/**
 * Simple local JSON-file persistence - no external database needed for V0.
 * Swallows write failures (e.g. a read-only filesystem on serverless
 * deployments like Vercel) so a persistence hiccup never breaks the task
 * pipeline itself - history is a nice-to-have, not a dependency of routing.
 * Upserts by id, so re-saving a task (e.g. to attach a new followUpTaskId)
 * updates it in place instead of duplicating the entry.
 */
export async function saveTaskToHistory(task: Task): Promise<void> {
  try {
    const tasks = await readAll();
    const existingIndex = tasks.findIndex((t) => t.id === task.id);
    if (existingIndex >= 0) {
      tasks[existingIndex] = task;
    } else {
      tasks.unshift(task);
    }
    await writeAll(tasks.slice(0, MAX_HISTORY));
  } catch (err) {
    console.warn("Could not persist task history:", err);
  }
}

export async function listHistory(): Promise<TaskHistoryEntry[]> {
  const tasks = await readAll();
  return tasks.map(toHistoryEntry).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getHistoryTask(id: string): Promise<Task | undefined> {
  const tasks = await readAll();
  return tasks.find((t) => t.id === id);
}

/** Every task gets exactly one trace ID (spec #57) - this is the lookup the `/traces/:traceId` page uses. */
export async function getHistoryTaskByTraceId(traceId: string): Promise<Task | undefined> {
  const tasks = await readAll();
  return tasks.find((t) => t.traceId === traceId);
}

/** Routing experiments (V4 #13) are derived from tasks run with comparison mode on - no separate store needed. */
export async function listExperiments(): Promise<RoutingExperiment[]> {
  const tasks = await readAll();
  return tasks
    .filter((t) => t.comparison)
    .map((t) => ({
      id: `exp-${t.id}`,
      taskId: t.id,
      raw_task: t.raw_task,
      createdAt: t.created_at,
      comparison: t.comparison!,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTaskLineage(rootTaskId: string): Promise<Task[]> {
  const tasks = await readAll();
  return tasks
    .filter((t) => t.rootTaskId === rootTaskId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function toHistoryEntry(task: Task): TaskHistoryEntry {
  const providers = new Set(
    task.plan.steps.map((s) => actualProviderName(s)).filter((n): n is string => Boolean(n))
  );
  return {
    id: task.id,
    parentTaskId: task.parentTaskId,
    rootTaskId: task.rootTaskId,
    workflow: task.workflow,
    mode: task.mode,
    raw_task: task.raw_task,
    created_at: task.created_at,
    completed_at: task.completed_at,
    status: task.status,
    inferred_capabilities: task.inferred_capabilities,
    providers_used: Array.from(providers),
    result_count: task.buyer_results.length,
    average_confidence: task.evaluation_summary.average_confidence,
    total_cost: task.evaluation_summary.total_cost,
    total_latency: task.evaluation_summary.total_latency,
  };
}
