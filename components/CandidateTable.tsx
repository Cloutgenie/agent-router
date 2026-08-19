import { RoutingCandidate } from "@/types";

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-10 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-muted">{value.toFixed(2)}</span>
    </div>
  );
}

export function CandidateTable({ candidates }: { candidates: RoutingCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-dim">
        No eligible agents were found for the inferred capabilities.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
            <th className="py-2 pr-3 font-medium">Agent</th>
            <th className="py-2 pr-3 font-medium">Capability fit</th>
            <th className="py-2 pr-3 font-medium">Quality</th>
            <th className="py-2 pr-3 font-medium">Reliability</th>
            <th className="py-2 pr-3 font-medium">Cost</th>
            <th className="py-2 pr-3 font-medium">Latency</th>
            <th className="py-2 pr-3 font-medium">Total score</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr
              key={candidate.agent.id}
              className={`border-b border-border/60 align-top transition ${
                candidate.selected ? "bg-accent-soft" : ""
              }`}
            >
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2">
                  {candidate.selected && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong" />
                  )}
                  <div>
                    <div className="font-medium text-foreground">
                      {candidate.agent.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-dim">
                      ${candidate.agent.price_per_task.toFixed(2)} ·{" "}
                      {candidate.agent.average_latency_seconds}s avg
                      {!candidate.within_budget && (
                        <span className="ml-1.5 text-bad">over budget</span>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-2.5 pr-3">
                <ScoreBar value={candidate.capability_fit} />
                <div className="mt-1 max-w-[160px] text-[10px] text-muted-dim">
                  {candidate.matched_capabilities.length} of{" "}
                  {candidate.matched_capabilities.length + candidate.missing_capabilities.length} covered
                </div>
              </td>
              <td className="py-2.5 pr-3">
                <ScoreBar value={candidate.quality_score} />
              </td>
              <td className="py-2.5 pr-3">
                <ScoreBar value={candidate.reliability_score} />
              </td>
              <td className="py-2.5 pr-3">
                <ScoreBar value={candidate.cost_efficiency} />
              </td>
              <td className="py-2.5 pr-3">
                <ScoreBar value={candidate.latency_score} />
              </td>
              <td className="py-2.5 pr-3">
                <span
                  className={`font-mono text-sm font-semibold ${
                    candidate.selected ? "text-accent-strong" : "text-foreground"
                  }`}
                >
                  {candidate.total_score.toFixed(2)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
