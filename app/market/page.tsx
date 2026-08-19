import Link from "next/link";
import { ModeBadge } from "@/components/ModeBadge";
import { StatTileRow } from "@/components/StatTiles";
import { getRuntimeConfig } from "@/lib/config";
import { getAllPerformanceMetrics } from "@/lib/history/performanceStore";
import { computeRoutingAdvantage } from "@/lib/history/routingAdvantage";
import { getAllHistoryTasks, listExperiments } from "@/lib/history/store";
import { computeCapabilityDemand, computeExecutionAlpha, computeMarketGaps, computeMarketOverview } from "@/lib/market/marketAnalytics";
import { getAllQuotes } from "@/lib/market/quoteStore";
import { getAllProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-bad/30 bg-bad-soft text-bad",
  medium: "border-warn/30 bg-warn-soft text-warn",
  low: "border-border text-muted-dim",
};

function AlphaTile({ label, value, unit }: { label: string; value: number; unit: string }) {
  const positive = value > 0;
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-dim">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${positive ? "text-good" : value < 0 ? "text-bad" : "text-foreground"}`}>
        {positive ? "+" : ""}
        {value}
        {unit}
      </div>
    </div>
  );
}

export default async function MarketPage() {
  const config = getRuntimeConfig();
  const providers = getAllProviders(config);
  const [tasks, quotes, performanceMetrics, experiments] = await Promise.all([
    getAllHistoryTasks(),
    getAllQuotes(),
    getAllPerformanceMetrics(),
    listExperiments(),
  ]);

  const demand = computeCapabilityDemand(tasks);
  const overview = computeMarketOverview(tasks, demand, providers, performanceMetrics);
  const gaps = computeMarketGaps(demand);
  const alpha = computeExecutionAlpha(tasks, quotes);
  const routingAdvantage = computeRoutingAdvantage(experiments);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <ModeBadge />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Execution market</h1>
        <p className="mt-1 text-sm text-muted">
          Executors compete on verified performance, price, and reliability - the router allocates work to the best
          execution path, not the loudest sales sheet. See{" "}
          <Link href="/supply" className="text-accent-strong hover:underline">Supply</Link> for executor-level
          detail and <Link href="/demand" className="text-accent-strong hover:underline">Demand</Link> for
          capability-level detail.
        </p>
      </div>

      <StatTileRow
        tiles={[
          { label: "Active executors", value: String(overview.activeExecutorCount) },
          { label: "Capabilities", value: String(overview.capabilityCount) },
          { label: "Execution volume", value: String(overview.executionVolume), sub: "completed steps" },
          { label: "Verified outcome rate", value: `${Math.round(overview.verifiedOutcomeRate * 100)}%` },
          { label: "Unmet demand", value: String(overview.unmetDemandCount), sub: "steps, no eligible executor" },
          { label: "Average cost", value: `$${overview.averageCost.toFixed(2)}`, sub: "per completed task" },
        ]}
      />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="card-raised p-5">
          <div className="mb-1 text-sm font-semibold text-foreground">Execution Alpha</div>
          <p className="mb-3 text-xs text-muted-dim">
            {alpha.sampleSize > 0
              ? `Value created by executor selection itself: the winner vs. the median of every executor actually quoted for the same step, across ${alpha.sampleSize} step${alpha.sampleSize === 1 ? "" : "s"} with real competition.`
              : "No steps yet had 2+ competing quotes to measure alpha against."}
          </p>
          {alpha.sampleSize > 0 && (
            <div className="grid grid-cols-2 gap-2.5">
              <AlphaTile label="Quality" value={Math.round(alpha.qualityLift * 100)} unit="%" />
              <AlphaTile label="Cost saved" value={alpha.costReduction} unit="$" />
              <AlphaTile label="Latency saved" value={Math.round(alpha.latencyReductionMs)} unit="ms" />
              <AlphaTile label="Reliability" value={Math.round(alpha.reliabilityLift * 100)} unit="%" />
            </div>
          )}
        </div>

        <div className="card-raised p-5">
          <div className="mb-1 text-sm font-semibold text-foreground">Routing Advantage</div>
          <p className="mb-3 text-xs text-muted-dim">
            {routingAdvantage
              ? `Routed multi-provider execution vs. a single-provider baseline, across ${routingAdvantage.sampleSize} experiment${routingAdvantage.sampleSize === 1 ? "" : "s"}. Distinct from Execution Alpha above - this compares the whole system, not just one step's executor choice.`
              : "No comparison-mode experiments yet - see Experiments."}
          </p>
          {routingAdvantage && (
            <div className="grid grid-cols-2 gap-2.5">
              <AlphaTile label="Quality" value={routingAdvantage.quality} unit="" />
              <AlphaTile label="Evidence coverage" value={Math.round(routingAdvantage.evidenceCoverage * 100)} unit="%" />
              <AlphaTile label="Verified claims" value={Math.round(routingAdvantage.verifiedClaimRate * 100)} unit="%" />
              <AlphaTile label="Failed records" value={Math.round(-routingAdvantage.failedRate * 100)} unit="%" />
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Market gaps</h2>
          <p className="text-[11px] text-muted-dim">Capabilities with thin supply or high failure rates</p>
        </div>
        {gaps.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted-dim">No capability demand recorded yet.</div>
        ) : (
          <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
                  <th className="py-2 pr-3 font-medium">Capability</th>
                  <th className="py-2 pr-3 font-medium">Demand</th>
                  <th className="py-2 pr-3 font-medium">Active executors</th>
                  <th className="py-2 pr-3 font-medium">Avg cost</th>
                  <th className="py-2 pr-3 font-medium">Failure rate</th>
                  <th className="py-2 pr-3 font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((gap) => (
                  <tr key={gap.capability} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 text-foreground">{gap.capability.replace(/-/g, " ")}</td>
                    <td className="py-2.5 pr-3 font-mono text-foreground">{gap.demandVolume}</td>
                    <td className="py-2.5 pr-3 font-mono text-foreground">{gap.activeExecutorCount}</td>
                    <td className="py-2.5 pr-3 font-mono text-foreground">${gap.avgCost.toFixed(2)}</td>
                    <td className="py-2.5 pr-3 font-mono text-foreground">{Math.round(gap.failureRate * 100)}%</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase ${SEVERITY_STYLES[gap.severity]}`}>
                        {gap.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
