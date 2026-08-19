import { ModeBadge } from "@/components/ModeBadge";
import { getAllHistoryTasks } from "@/lib/history/store";
import { computeCapabilityDemand } from "@/lib/market/marketAnalytics";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  const tasks = await getAllHistoryTasks();
  const demand = computeCapabilityDemand(tasks);
  const scarce = demand.filter((d) => d.stepCount > 0 && d.activeExecutorCount <= 1).length;
  const mostExpensive = [...demand].filter((d) => d.avgCost > 0).sort((a, b) => b.avgCost - a.avgCost)[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <ModeBadge />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Demand</h1>
        <p className="mt-1 text-sm text-muted">
          What the market is actually asking for, by capability: how much volume, how reliably it gets fulfilled,
          and where demand is outrunning supply.
          {scarce > 0 && ` ${scarce} capabilit${scarce === 1 ? "y has" : "ies have"} only one active executor.`}
          {mostExpensive && ` Most expensive: ${mostExpensive.capability.replace(/-/g, " ")} at $${mostExpensive.avgCost.toFixed(2)}/task.`}
        </p>
      </div>

      {demand.length === 0 ? (
        <div className="card p-6 text-center text-sm text-muted-dim">No tasks routed yet.</div>
      ) : (
        <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
                <th className="py-2 pr-3 font-medium">Capability</th>
                <th className="py-2 pr-3 font-medium">Tasks</th>
                <th className="py-2 pr-3 font-medium">Steps run</th>
                <th className="py-2 pr-3 font-medium">Success rate</th>
                <th className="py-2 pr-3 font-medium">Unmet demand</th>
                <th className="py-2 pr-3 font-medium">Active executors</th>
                <th className="py-2 pr-3 font-medium">Avg cost</th>
                <th className="py-2 pr-3 font-medium">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((d) => (
                <tr key={d.capability} className="border-b border-border/60">
                  <td className="py-2.5 pr-3 text-foreground">{d.capability.replace(/-/g, " ")}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{d.taskCount}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{d.stepCount}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{Math.round(d.successRate * 100)}%</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">
                    {d.unmetCount > 0 ? <span className="text-warn">{d.unmetCount}</span> : "0"}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">
                    {d.activeExecutorCount <= 1 ? <span className="text-warn">{d.activeExecutorCount}</span> : d.activeExecutorCount}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">${d.avgCost.toFixed(2)}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{d.avgLatencySeconds}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
