import { TaskHistoryEntry } from "@/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<string, string> = {
  completed: "border-good/30 bg-good-soft text-good",
  failed: "border-bad/30 bg-bad-soft text-bad",
};

export function HistoryTable({ history }: { history: TaskHistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted-dim">
        No tasks routed yet. Head back to{" "}
        <span className="text-accent-strong">Route</span> to run your first one.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
            <th className="py-2 pr-3 font-medium">Task</th>
            <th className="py-2 pr-3 font-medium">Agents</th>
            <th className="py-2 pr-3 font-medium">Cost</th>
            <th className="py-2 pr-3 font-medium">Quality</th>
            <th className="py-2 pr-3 font-medium">Latency</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.id} className="border-b border-border/60 align-top">
              <td className="max-w-[320px] py-2.5 pr-3">
                <div className="line-clamp-2 text-foreground">{entry.raw_task}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.inferred_capabilities.slice(0, 3).map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-strong"
                    >
                      {c.replace(/-/g, " ")}
                    </span>
                  ))}
                  {entry.inferred_capabilities.length > 3 && (
                    <span className="text-[10px] text-muted-dim">
                      +{entry.inferred_capabilities.length - 3}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2.5 pr-3 text-muted">{entry.agents_selected.join(", ") || "-"}</td>
              <td className="py-2.5 pr-3 font-mono text-foreground">${entry.total_cost.toFixed(2)}</td>
              <td className="py-2.5 pr-3 font-mono text-foreground">{entry.quality_score.toFixed(2)}</td>
              <td className="py-2.5 pr-3 font-mono text-foreground">{entry.total_latency}s</td>
              <td className="py-2.5 pr-3">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${
                    STATUS_STYLES[entry.status] ?? "border-border text-muted-dim"
                  }`}
                >
                  {entry.status}
                </span>
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap text-muted-dim">
                {formatDate(entry.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
