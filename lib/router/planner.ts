import {
  Capability,
  RoutingCandidate,
  RoutingPlan,
  TaskConstraints,
  TeamAssignment,
} from "@/types";
import { round2 } from "./scoring";

/**
 * Greedy capability-coverage set cover. Priority order:
 *   1. maximum capability coverage
 *   2. highest average quality (via total_score tie-break)
 *   3. staying inside budget (soft preference while budget remains)
 *   4. lowest number of agents (natural result of greedy max-coverage picks)
 */
export function buildRoutingPlan(
  requiredCapabilities: Capability[],
  candidates: RoutingCandidate[],
  constraints: TaskConstraints
): RoutingPlan {
  const rationale: string[] = [];
  const maxAgents = constraints.max_agents ?? 5;

  if (candidates.length === 0) {
    return {
      required_capabilities: requiredCapabilities,
      candidates: [],
      selected_agents: [],
      team: [],
      total_expected_cost: 0,
      estimated_latency_seconds: 0,
      overall_routing_score: 0,
      within_budget: true,
      within_deadline: true,
      rationale: ["No active agent covers any of the required capabilities."],
    };
  }

  // A single agent that fully covers the requirement is always preferable
  // to a team - fewer moving parts, no coordination overhead.
  const fullCoverageSingle = candidates.find(
    (c) => c.matched_capabilities.length === requiredCapabilities.length
  );

  let selected: RoutingCandidate[] = [];

  if (fullCoverageSingle) {
    selected = [fullCoverageSingle];
    rationale.push(
      `${fullCoverageSingle.agent.name} alone covers all ${requiredCapabilities.length} required capabilities (score ${fullCoverageSingle.total_score}) - no team needed.`
    );
  } else {
    const remaining = new Set(requiredCapabilities);
    const budget = constraints.budget;
    let spent = 0;
    const used = new Set<string>();

    while (remaining.size > 0 && selected.length < maxAgents) {
      const scored = candidates
        .filter((c) => !used.has(c.agent.id))
        .map((c) => ({
          candidate: c,
          newCoverage: c.matched_capabilities.filter((cap) => remaining.has(cap))
            .length,
        }))
        .filter((c) => c.newCoverage > 0);

      if (scored.length === 0) break;

      const remainingBudget = budget != null ? budget - spent : undefined;
      const affordable =
        remainingBudget != null
          ? scored.filter((c) => c.candidate.agent.price_per_task <= remainingBudget)
          : scored;
      const pickFrom = affordable.length > 0 ? affordable : scored;

      pickFrom.sort((a, b) => {
        if (b.newCoverage !== a.newCoverage) return b.newCoverage - a.newCoverage;
        return b.candidate.total_score - a.candidate.total_score;
      });

      const pick = pickFrom[0].candidate;
      selected.push(pick);
      used.add(pick.agent.id);
      spent += pick.agent.price_per_task;
      pick.matched_capabilities.forEach((cap) => remaining.delete(cap));

      rationale.push(
        `Added ${pick.agent.name} to cover ${pickFrom[0].newCoverage} capabilit${
          pickFrom[0].newCoverage === 1 ? "y" : "ies"
        } (${pick.matched_capabilities
          .filter((cap) => requiredCapabilities.includes(cap))
          .join(", ")}) - score ${pick.total_score}.`
      );
    }

    if (remaining.size > 0) {
      rationale.push(
        `No eligible agent could cover: ${Array.from(remaining).join(", ")}.`
      );
    }
  }

  // Build the team tree: assign each required capability to the first
  // selected agent (in pick order) that can perform it.
  const claimed = new Set<Capability>();
  const team: TeamAssignment[] = selected.map((candidate) => {
    const assigned = candidate.matched_capabilities.filter(
      (cap) => requiredCapabilities.includes(cap) && !claimed.has(cap)
    );
    assigned.forEach((cap) => claimed.add(cap));
    return {
      agent: candidate.agent,
      role: describeRole(candidate),
      assigned_capabilities: assigned.length > 0 ? assigned : candidate.matched_capabilities,
    };
  });

  const selectedAgents = selected.map((c) => c.agent);
  const totalCost = round2(selectedAgents.reduce((sum, a) => sum + a.price_per_task, 0));
  const latencies = selectedAgents.map((a) => a.average_latency_seconds);
  const estimatedLatency = round2(
    constraints.allow_parallel === false
      ? latencies.reduce((sum, l) => sum + l, 0)
      : Math.max(...latencies, 0)
  );
  const overallScore = round2(
    selected.reduce((sum, c) => sum + c.total_score, 0) / Math.max(selected.length, 1)
  );

  const withinBudget = constraints.budget == null || totalCost <= constraints.budget;
  const withinDeadline =
    constraints.deadline_minutes == null ||
    estimatedLatency <= constraints.deadline_minutes * 60;

  if (!withinBudget) {
    rationale.push(
      `Total expected cost $${totalCost.toFixed(2)} exceeds the $${constraints.budget?.toFixed(
        2
      )} budget - consider raising the budget or lowering quality preference.`
    );
  }
  if (!withinDeadline) {
    rationale.push(
      `Estimated latency ${estimatedLatency}s exceeds the ${constraints.deadline_minutes}min deadline - consider allowing parallel execution.`
    );
  }
  if (selected.length > 1 && constraints.allow_parallel !== false) {
    rationale.push(
      `${selected.length} agents will run in parallel; estimated latency uses the slowest agent (${estimatedLatency}s).`
    );
  }

  return {
    required_capabilities: requiredCapabilities,
    candidates: candidates.map((c) => ({
      ...c,
      selected: selected.some((s) => s.agent.id === c.agent.id),
    })),
    selected_agents: selectedAgents,
    team,
    total_expected_cost: totalCost,
    estimated_latency_seconds: estimatedLatency,
    overall_routing_score: overallScore,
    within_budget: withinBudget,
    within_deadline: withinDeadline,
    rationale,
  };
}

function describeRole(candidate: RoutingCandidate): string {
  return candidate.matched_capabilities
    .map((c) => c.replace(/-/g, " "))
    .join(" + ");
}
