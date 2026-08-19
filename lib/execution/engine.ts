import { mockAgentProvider } from "@/lib/agents/provider";
import {
  AgentExecution,
  AgentProvider,
  AgentTaskRequest,
  TeamAssignment,
} from "@/types";

async function runAssignment(
  taskId: string,
  rawTask: string,
  assignment: TeamAssignment,
  provider: AgentProvider
): Promise<AgentExecution> {
  const request: AgentTaskRequest = {
    task_id: taskId,
    raw_task: rawTask,
    capability: assignment.assigned_capabilities[0] ?? assignment.agent.capabilities[0],
    assigned_capabilities: assignment.assigned_capabilities,
  };

  const result = await provider.execute(assignment.agent, request);

  return {
    agent_id: assignment.agent.id,
    agent_name: assignment.agent.name,
    role: assignment.role,
    status: result.status,
    duration_seconds: result.duration_seconds,
    cost: result.cost,
    confidence: result.confidence,
    result: result.status === "completed" ? result.result : { error: result.error },
  };
}

/** Yields each promise's resolved value as soon as it settles, in completion order. */
async function* asCompleted<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  const pending = new Map<number, Promise<{ idx: number; value: T }>>();
  promises.forEach((p, idx) => pending.set(idx, p.then((value) => ({ idx, value }))));

  while (pending.size > 0) {
    const { idx, value } = await Promise.race(pending.values());
    pending.delete(idx);
    yield value;
  }
}

/**
 * Mock Execution Engine. Runs the routed team - sequentially or in parallel
 * - against the shared `AgentProvider` interface and yields each
 * `AgentExecution` as soon as it completes, so callers can stream live
 * execution progress.
 */
export async function* executeTeam(
  taskId: string,
  rawTask: string,
  team: TeamAssignment[],
  allowParallel: boolean,
  provider: AgentProvider = mockAgentProvider
): AsyncGenerator<AgentExecution> {
  if (allowParallel) {
    const runs = team.map((assignment) =>
      runAssignment(taskId, rawTask, assignment, provider)
    );
    yield* asCompleted(runs);
  } else {
    for (const assignment of team) {
      yield await runAssignment(taskId, rawTask, assignment, provider);
    }
  }
}
