import { AgentExecution, ExecutionStatus, TeamAssignment, TraceEvent } from "@/types";

const STATUS_STYLES: Record<ExecutionStatus, string> = {
  pending: "border-border text-muted-dim",
  running: "border-accent/40 bg-accent-soft text-accent-strong",
  completed: "border-good/30 bg-good-soft text-good",
  failed: "border-bad/30 bg-bad-soft text-bad",
};

function formatKey(key: string) {
  return key.replace(/_/g, " ");
}

function formatVal(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function AgentExecutionCard({
  assignment,
  execution,
}: {
  assignment: TeamAssignment;
  execution?: AgentExecution;
}) {
  const status: ExecutionStatus = execution?.status ?? "running";

  return (
    <div className="card animate-fade-in-up p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">{assignment.agent.name}</div>
          <div className="text-[11px] text-muted-dim">
            {assignment.assigned_capabilities.map((c) => c.replace(/-/g, " ")).join(", ")}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[status]}`}
        >
          {status === "running" && (
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent-strong" />
          )}
          {status}
        </span>
      </div>

      {execution ? (
        <>
          <div className="mt-3 flex gap-4 font-mono text-[11px] text-muted">
            <span>{execution.duration_seconds}s</span>
            <span>${execution.cost.toFixed(2)}</span>
            {execution.status === "completed" && <span>{Math.round(execution.confidence * 100)}% conf.</span>}
          </div>
          {execution.status === "completed" ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              {Object.entries(execution.result).map(([key, value]) => (
                <div key={key} className="col-span-2 flex justify-between gap-2 border-t border-border/60 py-1 first:border-t-0 first:pt-0">
                  <dt className="text-muted-dim">{formatKey(key)}</dt>
                  <dd className="text-right font-medium text-foreground">{formatVal(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-[12px] text-bad">
              {(execution.result.error as string) ?? "Execution failed."}
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full w-1/3 animate-pulse-dot rounded-full bg-accent" />
        </div>
      )}
    </div>
  );
}

export function ExecutionGrid({
  team,
  executions,
}: {
  team: TeamAssignment[];
  executions: AgentExecution[];
}) {
  const byAgent = new Map(executions.map((e) => [e.agent_id, e]));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {team.map((assignment) => (
        <AgentExecutionCard
          key={assignment.agent.id}
          assignment={assignment}
          execution={byAgent.get(assignment.agent.id)}
        />
      ))}
    </div>
  );
}

export function TraceLog({ trace }: { trace: TraceEvent[] }) {
  if (trace.length === 0) return null;

  return (
    <div className="card p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">
        Execution trace
      </div>
      <ol className="space-y-1.5">
        {trace.map((event, i) => (
          <li key={i} className="animate-fade-in-up flex items-baseline gap-2 text-[13px]">
            <span className="font-mono text-[10px] text-muted-dim">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-foreground">{event.label}</span>
            {event.detail && <span className="truncate text-muted-dim">- {event.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
