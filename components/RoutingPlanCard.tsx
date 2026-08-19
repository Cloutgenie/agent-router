import { RoutingPlan } from "@/types";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-dim">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function RoutingPlanCard({ plan }: { plan: RoutingPlan }) {
  const teamSize = plan.selected_agents.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Selected"
          value={teamSize === 1 ? "1 agent" : `${teamSize} agents`}
          sub={plan.selected_agents.map((a) => a.name).join(", ")}
        />
        <StatTile label="Expected cost" value={`$${plan.total_expected_cost.toFixed(2)}`} sub={plan.within_budget ? undefined : "over budget"} />
        <StatTile
          label="Est. latency"
          value={`${plan.estimated_latency_seconds}s`}
          sub={plan.within_deadline ? undefined : "over deadline"}
        />
        <StatTile label="Routing score" value={plan.overall_routing_score.toFixed(2)} sub="0-1 weighted" />
      </div>

      <div className="card p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-dim">
          Team structure
        </div>
        <div className="space-y-2 font-mono text-[13px]">
          <div className="text-muted">Task</div>
          {plan.team.map((assignment, index) => (
            <div key={assignment.agent.id} className="pl-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-l border-border-strong pl-3">
                <span className="text-muted-dim">
                  {index === plan.team.length - 1 ? "└──" : "├──"}
                </span>
                <span className="font-semibold text-accent-strong">{assignment.agent.name}</span>
                <span className="text-[11px] text-muted-dim">
                  ${assignment.agent.price_per_task.toFixed(2)} · {assignment.agent.average_latency_seconds}s
                </span>
              </div>
              <div className="pl-7 text-[12px] text-muted">
                {assignment.assigned_capabilities.map((c) => c.replace(/-/g, " ")).join(", ")}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">
          Why this routing
        </div>
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
          {plan.rationale.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">→</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
