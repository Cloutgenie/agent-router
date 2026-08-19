import { Evidence, PersistentAgentExecutor, PersistentExecution, PersistentExecutionStatus, ProviderResult, ProviderTask } from "@/types";
import { jitter, makeEvidence, round2, sleep } from "../shared";

interface TrackedExecution extends PersistentExecution {
  result?: ProviderResult;
  /** The single in-flight run for this execution - execute() awaits this instead of starting a second, duplicate run. */
  promise?: Promise<ProviderResult>;
}

/**
 * Demo-mode stand-in for a persistent agent worker (spec #9, #97 - "Run the
 * entire acceptance test without any external credentials"). Unlike the
 * real shell (lib/providers/adapters/persistentAgentExecutor.ts), this one
 * actually exercises the full pending -> running -> completed lifecycle:
 * `startTask` returns immediately with a real in-progress record,
 * `getStatus` reflects genuine state transitions if polled mid-flight, and
 * `execute()` (the synchronous bridge the current router/execution engine
 * calls) awaits that same lifecycle to completion rather than faking a
 * single-shot response. Every result is clearly labeled a simulation.
 */
const executions = new Map<string, TrackedExecution>();

let counter = 0;
function nextExecutionId(): string {
  counter += 1;
  return `demo-persistent-${Date.now().toString(36)}-${counter}`;
}

function setStatus(executionId: string, status: PersistentExecutionStatus, result?: ProviderResult): void {
  const existing = executions.get(executionId);
  if (!existing) return;
  existing.status = status;
  if (result) existing.result = result;
}

function narrativeFor(task: ProviderTask): string {
  switch (task.capability) {
    case "terminal-execution":
      return `[DEMO SIMULATION] Ran a sandboxed command worker against: "${task.goal}".`;
    case "authenticated-browser":
      return `[DEMO SIMULATION] Completed an authenticated-session browser task for: "${task.goal}".`;
    case "agent-delegation":
      return `[DEMO SIMULATION] Delegated part of "${task.goal}" to a simulated external agent and collected its result.`;
    default:
      return `[DEMO SIMULATION] Persistent worker finished a long-running task for: "${task.goal}".`;
  }
}

async function runToCompletion(executionId: string, task: ProviderTask, provider: PersistentAgentExecutor): Promise<ProviderResult> {
  setStatus(executionId, "running");
  const simulatedSeconds = Math.max(1, jitter(provider.average_latency_seconds, 4));
  await sleep(Math.min(simulatedSeconds * 150, 2500));

  if (Math.random() > provider.success_rate) {
    const failed: ProviderResult = {
      status: "failed",
      data: {},
      evidence: [],
      confidence: 0,
      cost: round2(provider.price_per_task * 0.4),
      duration_seconds: round2(simulatedSeconds),
      error: `${provider.name} worker failed partway through (simulated failure).`,
    };
    setStatus(executionId, "failed", failed);
    return failed;
  }

  const text = narrativeFor(task);
  const evidence: Evidence[] = [
    makeEvidence({
      type: "provider_output",
      title: `Persistent agent result - ${task.capability.replace(/-/g, " ")}`,
      source: "Persistent Agent Worker (Demo)",
      excerpt: text,
      confidence: round2(jitter(provider.quality_score, 0.05)),
      sourceQuality: "medium",
      query: task.goal,
    }),
  ];

  const completed: ProviderResult = {
    status: "completed",
    data: { executionId, narrative: text },
    evidence,
    confidence: round2(Math.min(0.95, Math.max(0.5, jitter(provider.quality_score, 0.06)))),
    cost: provider.price_per_task,
    duration_seconds: round2(simulatedSeconds),
  };
  setStatus(executionId, "completed", completed);
  return completed;
}

export const MockPersistentAgentExecutor: PersistentAgentExecutor = {
  id: "persistent-agent-mock",
  name: "Persistent Agent Worker (Demo)",
  description: "Simulated long-running computer/browser/terminal worker - exercises the full start/poll/complete lifecycle with zero credentials.",
  capabilities: ["long-running-task", "authenticated-browser", "terminal-execution", "agent-delegation"],
  protocol: "mock",
  quality_score: 0.8,
  reliability_score: 0.82,
  success_rate: 0.88,
  price_per_task: 1.5,
  average_latency_seconds: 6,
  configured: true,

  async startTask(input: ProviderTask): Promise<PersistentExecution> {
    const executionId = nextExecutionId();
    const record: TrackedExecution = { executionId, status: "pending", startedAt: new Date().toISOString() };
    executions.set(executionId, record);
    // Genuinely asynchronous - callers can poll getStatus() before this settles.
    // Exactly one run per execution: stored so execute() awaits this same
    // promise instead of triggering a second, duplicate run.
    record.promise = runToCompletion(executionId, input, MockPersistentAgentExecutor);
    record.promise.catch(() => undefined); // never let an un-awaited rejection surface as an unhandled rejection
    return { executionId, status: record.status, startedAt: record.startedAt };
  },

  async getStatus(executionId: string): Promise<PersistentExecution> {
    const record = executions.get(executionId);
    if (!record) throw new Error(`Unknown execution: ${executionId}`);
    return { executionId: record.executionId, status: record.status, startedAt: record.startedAt };
  },

  async resumeTask(executionId: string): Promise<ProviderResult> {
    const record = executions.get(executionId);
    if (!record) throw new Error(`Unknown execution: ${executionId}`);
    if (record.result) return record.result;
    throw new Error(`Execution ${executionId} has not finished yet (status: ${record.status}).`);
  },

  async cancelTask(executionId: string): Promise<void> {
    const record = executions.get(executionId);
    if (!record) return;
    if (record.status === "pending" || record.status === "running") {
      setStatus(executionId, "cancelled", {
        status: "failed",
        data: {},
        evidence: [],
        confidence: 0,
        cost: 0,
        duration_seconds: 0,
        error: "Cancelled by the user.",
      });
    }
  },

  async execute(task: ProviderTask): Promise<ProviderResult> {
    const { executionId } = await this.startTask(task);
    return executions.get(executionId)!.promise!;
  },

  async healthCheck(): Promise<boolean> {
    await sleep(30);
    return true;
  },
};
