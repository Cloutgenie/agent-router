import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { actualProviderName } from "@/lib/providerLabel";
import { RoutingExperiment, Task, TaskHistoryEntry } from "@/types";

const MAX_HISTORY = 200;

function toTask(row: Record<string, unknown>): Task {
  return row.data as Task;
}

/**
 * Postgres-backed task history (`tasks` table) - replaces the local
 * data/history.json file, which never actually persisted on Vercel (every
 * write there threw EROFS: read-only filesystem). Swallows write failures
 * regardless, same as before: history is a nice-to-have, not a dependency
 * of routing. Upserts by id, so re-saving a task (e.g. to attach a new
 * followUpTaskId) updates it in place instead of duplicating the entry.
 */
export async function saveTaskToHistory(task: Task): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseClient().from("tasks").upsert({
      id: task.id,
      trace_id: task.traceId,
      root_task_id: task.rootTaskId,
      mode: task.mode,
      status: task.status,
      created_at: task.created_at,
      data: task,
    });
    if (error) throw error;

    // Trim to the most recent MAX_HISTORY tasks, same retention cap as the file version.
    const { data: excess, error: listErr } = await getSupabaseClient()
      .from("tasks")
      .select("id")
      .order("created_at", { ascending: false })
      .range(MAX_HISTORY, MAX_HISTORY + 100);
    if (listErr) throw listErr;
    if (excess && excess.length > 0) {
      await getSupabaseClient()
        .from("tasks")
        .delete()
        .in("id", excess.map((r) => r.id));
    }
  } catch (err) {
    console.warn("Could not persist task history:", err);
  }
}

/** Full `Task[]` for every persisted task - for analytics that need `plan.steps`/`candidates`, not just the summarized `TaskHistoryEntry` shape `listHistory()` returns. */
export async function getAllHistoryTasks(): Promise<Task[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient().from("tasks").select("data").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toTask);
}

export async function listHistory(): Promise<TaskHistoryEntry[]> {
  const tasks = await getAllHistoryTasks();
  return tasks.map(toHistoryEntry).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getHistoryTask(id: string): Promise<Task | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const { data, error } = await getSupabaseClient().from("tasks").select("data").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toTask(data) : undefined;
}

/** Every task gets exactly one trace ID (spec #57) - this is the lookup the `/traces/:traceId` page uses. */
export async function getHistoryTaskByTraceId(traceId: string): Promise<Task | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const { data, error } = await getSupabaseClient().from("tasks").select("data").eq("trace_id", traceId).maybeSingle();
  if (error) throw error;
  return data ? toTask(data) : undefined;
}

/** Routing experiments (V4 #13) are derived from tasks run with comparison mode on - no separate store needed. */
export async function listExperiments(): Promise<RoutingExperiment[]> {
  const tasks = await getAllHistoryTasks();
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
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient()
    .from("tasks")
    .select("data")
    .eq("root_task_id", rootTaskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTask);
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
