import { Evaluation, FinalResult, RoutingPlan } from "@/types";

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-dim">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function FinalResultCard({
  result,
  evaluation,
  plan,
}: {
  result: FinalResult;
  evaluation: Evaluation;
  plan: RoutingPlan;
}) {
  return (
    <div className="card-raised p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good-soft text-good">
          ✓
        </span>
        <h3 className="text-sm font-semibold text-foreground">Outcome</h3>
      </div>

      <p className="text-[15px] leading-relaxed text-foreground">{result.summary}</p>

      {result.highlights.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px] text-muted">
          {result.highlights.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">•</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Agents used" value={String(plan.selected_agents.length)} />
        <MetricTile label="Total cost" value={`$${evaluation.total_cost.toFixed(2)}`} />
        <MetricTile label="Total time" value={`${evaluation.total_latency}s`} />
        <MetricTile label="Quality score" value={evaluation.overall_score.toFixed(2)} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-dim">Completeness</div>
          <div className="font-mono text-sm text-foreground">{Math.round(evaluation.completeness * 100)}%</div>
        </div>
        <div className="rounded-lg bg-surface px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-dim">Confidence</div>
          <div className="font-mono text-sm text-foreground">{Math.round(evaluation.confidence * 100)}%</div>
        </div>
        <div className="rounded-lg bg-surface px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-dim">Est. accuracy</div>
          <div className="font-mono text-sm text-foreground">{Math.round(evaluation.estimated_accuracy * 100)}%</div>
        </div>
      </div>
    </div>
  );
}
