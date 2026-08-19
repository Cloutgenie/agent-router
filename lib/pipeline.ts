import { randomUUID } from "node:crypto";
import { capabilityClassifier } from "@/lib/capabilities/classifier";
import { getActiveAgents } from "@/lib/agents/registry";
import { scoreCandidates } from "@/lib/router/scoring";
import { buildRoutingPlan } from "@/lib/router/planner";
import { executeTeam } from "@/lib/execution/engine";
import { evaluateExecution } from "@/lib/evaluation/evaluator";
import { saveTaskToHistory } from "@/lib/history/store";
import {
  AgentExecution,
  Capability,
  Evaluation,
  FinalResult,
  RoutingCandidate,
  RoutingPlan,
  Task,
  TaskConstraints,
  TaskStatus,
  TraceEvent,
} from "@/types";

export type PipelineEvent =
  | { type: "trace"; event: TraceEvent }
  | { type: "capabilities"; data: Capability[] }
  | { type: "candidates"; data: RoutingCandidate[] }
  | { type: "plan"; data: RoutingPlan }
  | { type: "execution"; data: AgentExecution }
  | { type: "evaluation"; data: Evaluation }
  | { type: "final"; data: Task }
  | { type: "error"; message: string };

function nowIso(): string {
  return new Date().toISOString();
}

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function synthesizeFinalResult(
  plan: RoutingPlan,
  executions: AgentExecution[],
  evaluation: Evaluation
): FinalResult {
  const completed = executions.filter((e) => e.status === "completed");
  const failed = executions.filter((e) => e.status === "failed");
  const agentNames = plan.selected_agents.map((a) => a.name).join(", ");

  const summary =
    completed.length > 0
      ? `${agentNames} completed the task with ${Math.round(
          evaluation.completeness * 100
        )}% capability coverage and ${Math.round(
          evaluation.confidence * 100
        )}% average confidence.`
      : "The routed team was unable to complete the task - all agents failed.";

  const highlights: string[] = [];
  completed.forEach((e) => {
    Object.entries(e.result).forEach(([key, value]) => {
      highlights.push(`${e.agent_name}: ${key.replace(/_/g, " ")} = ${formatValue(value)}`);
    });
  });
  if (failed.length > 0) {
    highlights.push(
      `${failed.length} agent${failed.length > 1 ? "s" : ""} failed: ${failed
        .map((f) => f.agent_name)
        .join(", ")}`
    );
  }

  const outputs: Record<string, unknown> = {};
  executions.forEach((e) => {
    outputs[e.agent_name] = e.result;
  });

  return { summary, highlights, outputs };
}

/**
 * Runs the full GOAL -> CAPABILITY ANALYSIS -> AGENT MARKET -> ROUTING ->
 * EXECUTION -> EVALUATION -> OUTCOME pipeline, yielding an event after each
 * stage so the caller (the streaming API route) can push live progress to
 * the client.
 */
export async function* runTaskPipeline(
  rawTask: string,
  constraints: TaskConstraints
): AsyncGenerator<PipelineEvent, Task> {
  const taskId = randomUUID();
  const createdAt = nowIso();
  const trace: TraceEvent[] = [];

  const emitTrace = (label: string, detail?: string): PipelineEvent => {
    const event: TraceEvent = { label, detail, timestamp: nowIso() };
    trace.push(event);
    return { type: "trace", event };
  };

  yield emitTrace("Task received", rawTask);

  const capabilities = capabilityClassifier.classify(rawTask);
  yield emitTrace(`Detected ${capabilities.length} capabilities`, capabilities.join(", "));
  yield { type: "capabilities", data: capabilities };

  const agents = getActiveAgents();
  const candidates = scoreCandidates(capabilities, agents, constraints);
  yield emitTrace(`Evaluated ${candidates.length} agents`);
  yield { type: "candidates", data: candidates };

  const plan = buildRoutingPlan(capabilities, candidates, constraints);
  const teamSize = plan.selected_agents.length;
  yield emitTrace(
    `Selected ${teamSize}-agent ${teamSize === 1 ? "solo" : "team"}`,
    plan.selected_agents.map((a) => a.name).join(", ")
  );
  yield { type: "plan", data: plan };

  const executions: AgentExecution[] = [];
  const allowParallel = constraints.allow_parallel ?? true;
  for await (const execution of executeTeam(taskId, rawTask, plan.team, allowParallel)) {
    executions.push(execution);
    yield emitTrace(`${execution.agent_name} ${execution.status}`);
    yield { type: "execution", data: execution };
  }

  const evaluation = evaluateExecution(plan.team, executions, capabilities, allowParallel);
  yield emitTrace("Results evaluated");
  yield { type: "evaluation", data: evaluation };

  const finalResult = synthesizeFinalResult(plan, executions, evaluation);
  yield emitTrace("Final result produced");

  const status: TaskStatus =
    executions.length > 0 && executions.every((e) => e.status === "failed")
      ? "failed"
      : "completed";

  const task: Task = {
    id: taskId,
    raw_task: rawTask,
    created_at: createdAt,
    completed_at: nowIso(),
    budget: constraints.budget,
    deadline_minutes: constraints.deadline_minutes,
    quality_preference: constraints.quality_preference ?? "standard",
    max_agents: constraints.max_agents ?? 5,
    allow_parallel: allowParallel,
    status,
    inferred_capabilities: capabilities,
    routing_plan: plan,
    executions,
    evaluation,
    final_result: finalResult,
    execution_trace: trace,
  };

  await saveTaskToHistory(task);

  yield { type: "final", data: task };

  return task;
}
