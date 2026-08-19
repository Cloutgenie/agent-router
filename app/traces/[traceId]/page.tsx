import Link from "next/link";
import { notFound } from "next/navigation";
import { ModeBadge } from "@/components/ModeBadge";
import { PlanGraph } from "@/components/PlanGraph";
import { StatTileRow } from "@/components/StatTiles";
import { TraceLog } from "@/components/TraceLog";
import { getHistoryTaskByTraceId } from "@/lib/history/store";
import { actualProviderName } from "@/lib/providerLabel";

export const dynamic = "force-dynamic";

/**
 * Internal trace view (spec #57): plan, routing decisions, executor
 * selection, timing, fallbacks, cost, and errors for one trace ID - the
 * technical companion to the buyer-facing `/tasks/[id]` deliverable view.
 * Every task carries exactly one trace ID (lib/pipeline.ts), so this is a
 * 1:1 lookup, not a separate store.
 */
export default async function TraceDetailPage({ params }: PageProps<"/traces/[traceId]">) {
  const { traceId } = await params;
  const task = await getHistoryTaskByTraceId(traceId);
  if (!task) notFound();

  const failedSteps = task.plan.steps.filter((s) => s.status === "failed" && s.result?.error);
  const fallbackSteps = task.plan.steps.filter((s) => s.usedFallback);

  const tiles = [
    { label: "Status", value: task.status },
    { label: "Mode", value: task.mode === "live" ? "Live" : "Demo" },
    { label: "Total cost", value: `$${task.evaluation_summary.total_cost.toFixed(2)}` },
    { label: "Total latency", value: `${task.evaluation_summary.total_latency.toFixed(1)}s` },
    { label: "Providers used", value: String(task.evaluation_summary.providers_used) },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <ModeBadge />
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Trace {task.traceId}</h1>
          <p className="mt-1 text-xs text-muted-dim">
            {new Date(task.created_at).toLocaleString()} · {task.raw_task}
          </p>
        </div>
        <Link
          href={`/tasks/${task.id}`}
          className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-raised"
        >
          View deliverable →
        </Link>
      </div>

      <div className="mb-6">
        <StatTileRow tiles={tiles} />
      </div>

      {task.budget_outcome && (
        <div className="card mb-6 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">Budget</div>
          <div className="flex flex-wrap gap-4 text-[13px] text-foreground">
            <span>Budget: ${task.budget_outcome.budget.toFixed(2)}</span>
            <span>Estimated: ${task.budget_outcome.estimated.toFixed(2)}</span>
            <span>Actual: ${task.budget_outcome.actual.toFixed(2)}</span>
          </div>
          <ul className="mt-2 space-y-1 text-[12px] text-muted-dim">
            {task.budget_outcome.adjustments.map((note, i) => (
              <li key={i}>· {note}</li>
            ))}
          </ul>
        </div>
      )}

      {(failedSteps.length > 0 || fallbackSteps.length > 0) && (
        <div className="card mb-6 space-y-2 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Fallbacks &amp; errors</div>
          {fallbackSteps.map((s) => (
            <p key={`fb-${s.id}`} className="text-[13px] text-warn">
              {s.description}: fell back to {actualProviderName(s) ?? "an unknown provider"}
            </p>
          ))}
          {failedSteps.map((s) => (
            <p key={`err-${s.id}`} className="text-[13px] text-bad">
              {s.description}: {s.result?.error}
            </p>
          ))}
        </div>
      )}

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Execution plan &amp; routing decisions</h2>
        <PlanGraph steps={task.plan.steps} />
      </div>

      <TraceLog trace={task.execution_trace} />
    </div>
  );
}
