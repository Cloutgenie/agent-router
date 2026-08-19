import fs from "node:fs/promises";
import path from "node:path";
import { Task, TaskHistoryEntry } from "@/types";

const HISTORY_PATH = path.join(process.cwd(), "data", "history.json");
const MAX_HISTORY = 100;

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
 */
export async function saveTaskToHistory(task: Task): Promise<void> {
  try {
    const tasks = await readAll();
    tasks.unshift(task);
    await writeAll(tasks.slice(0, MAX_HISTORY));
  } catch (err) {
    console.warn("Could not persist task history:", err);
  }
}

export async function listHistory(): Promise<TaskHistoryEntry[]> {
  const tasks = await readAll();
  return tasks.map(toHistoryEntry);
}

export async function getHistoryTask(id: string): Promise<Task | undefined> {
  const tasks = await readAll();
  return tasks.find((t) => t.id === id);
}

function toHistoryEntry(task: Task): TaskHistoryEntry {
  return {
    id: task.id,
    raw_task: task.raw_task,
    created_at: task.created_at,
    completed_at: task.completed_at,
    status: task.status,
    inferred_capabilities: task.inferred_capabilities,
    agents_selected: task.routing_plan?.selected_agents.map((a) => a.name) ?? [],
    total_cost: task.evaluation?.total_cost ?? 0,
    quality_score: task.evaluation?.overall_score ?? 0,
    total_latency: task.evaluation?.total_latency ?? 0,
  };
}
