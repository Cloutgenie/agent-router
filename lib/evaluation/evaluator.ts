import {
  AgentExecution,
  AgentPerformance,
  Capability,
  Evaluation,
  TeamAssignment,
} from "@/types";
import { round2 } from "@/lib/router/scoring";

/**
 * Evaluation Engine. Scores the outcome of an execution run against the
 * capabilities the router originally required - not just "did the agents
 * run" but "did the result actually satisfy the task."
 */
export function evaluateExecution(
  team: TeamAssignment[],
  executions: AgentExecution[],
  requiredCapabilities: Capability[],
  allowParallel: boolean
): Evaluation {
  const completed = executions.filter((e) => e.status === "completed");
  const assignmentByAgent = new Map(team.map((t) => [t.agent.id, t]));

  const coveredCapabilities = new Set<Capability>();
  completed.forEach((execution) => {
    const assignment = assignmentByAgent.get(execution.agent_id);
    assignment?.assigned_capabilities.forEach((cap) => {
      if (requiredCapabilities.includes(cap)) coveredCapabilities.add(cap);
    });
  });

  const completeness =
    requiredCapabilities.length > 0
      ? round2(
          Math.min(1, coveredCapabilities.size / requiredCapabilities.length)
        )
      : 1;

  const confidence =
    completed.length > 0
      ? round2(completed.reduce((sum, e) => sum + e.confidence, 0) / completed.length)
      : 0;

  const quality =
    completed.length > 0
      ? round2(
          completed.reduce((sum, e) => {
            const agent = assignmentByAgent.get(e.agent_id)?.agent;
            return sum + (agent?.quality_score ?? 0);
          }, 0) / completed.length
        )
      : 0;

  const estimatedAccuracy = round2(
    quality * 0.4 + confidence * 0.4 + completeness * 0.2
  );

  const overallScore = round2(
    (quality + completeness + confidence + estimatedAccuracy) / 4
  );

  const totalCost = round2(executions.reduce((sum, e) => sum + e.cost, 0));
  const durations = executions.map((e) => e.duration_seconds);
  const totalLatency = round2(
    allowParallel ? Math.max(...durations, 0) : durations.reduce((s, d) => s + d, 0)
  );

  const agentPerformance: AgentPerformance[] = executions.map((execution) => {
    const assignment = assignmentByAgent.get(execution.agent_id);
    const contribution =
      requiredCapabilities.length > 0
        ? round2(
            (assignment?.assigned_capabilities.length ?? 0) /
              requiredCapabilities.length
          )
        : 0;
    return {
      agent_id: execution.agent_id,
      agent_name: execution.agent_name,
      contribution,
      quality_contribution:
        execution.status === "completed"
          ? round2(assignment?.agent.quality_score ?? 0)
          : 0,
      cost: execution.cost,
      duration_seconds: execution.duration_seconds,
    };
  });

  return {
    quality,
    completeness,
    confidence,
    estimated_accuracy: estimatedAccuracy,
    total_cost: totalCost,
    total_latency: totalLatency,
    overall_score: overallScore,
    agent_performance: agentPerformance,
  };
}
