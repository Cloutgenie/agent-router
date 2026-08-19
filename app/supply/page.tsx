import { ModeBadge } from "@/components/ModeBadge";
import { getRuntimeConfig } from "@/lib/config";
import { getAllHistoryTasks } from "@/lib/history/store";
import { computeExecutorSupply } from "@/lib/market/marketAnalytics";
import { getAllProviders } from "@/lib/providers/registry";
import { listProviderOverrides } from "@/lib/providers/overrideStore";

export const dynamic = "force-dynamic";

const TRUST_TIER_STYLES: Record<string, string> = {
  new: "border-muted-dim/30 bg-surface-raised text-muted-dim",
  probation: "border-warn/30 bg-warn-soft text-warn",
  trusted: "border-good/30 bg-good-soft text-good",
  degraded: "border-bad/30 bg-bad-soft text-bad",
  suspended: "border-bad/30 bg-bad-soft text-bad",
};

export default async function SupplyPage() {
  const config = getRuntimeConfig();
  const providers = getAllProviders(config);
  const [tasks, overrides] = await Promise.all([getAllHistoryTasks(), listProviderOverrides()]);
  const supply = computeExecutorSupply(tasks, providers, overrides)
    .sort((a, b) => b.jobsCompleted - a.jobsCompleted || b.timesEligible - a.timesEligible);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <ModeBadge />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Supply</h1>
        <p className="mt-1 text-sm text-muted">
          Every executor known to the router - mock and real - and how it has actually performed: how often it wins
          when eligible, what it costs, and its trust standing. Connect your own executor, prove performance,
          receive work.
        </p>
      </div>

      <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
              <th className="py-2 pr-3 font-medium">Executor</th>
              <th className="py-2 pr-3 font-medium">Capabilities</th>
              <th className="py-2 pr-3 font-medium">Trust</th>
              <th className="py-2 pr-3 font-medium">Eligible</th>
              <th className="py-2 pr-3 font-medium">Won</th>
              <th className="py-2 pr-3 font-medium">Win rate</th>
              <th className="py-2 pr-3 font-medium">Avg price</th>
              <th className="py-2 pr-3 font-medium">Revenue opportunity</th>
            </tr>
          </thead>
          <tbody>
            {supply.map((s) => (
              <tr key={s.executorId} className="border-b border-border/60 align-top">
                <td className="py-2.5 pr-3">
                  <div className="text-foreground">{s.executorName}</div>
                  {!s.configured && <div className="text-[10px] text-muted-dim">not configured</div>}
                </td>
                <td className="max-w-[220px] py-2.5 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {s.capabilities.slice(0, 3).map((c) => (
                      <span key={c} className="rounded-full bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted">
                        {c.replace(/-/g, " ")}
                      </span>
                    ))}
                    {s.capabilities.length > 3 && (
                      <span className="text-[10px] text-muted-dim">+{s.capabilities.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] capitalize ${TRUST_TIER_STYLES[s.trustTier]}`}>
                    {s.trustTier}
                  </span>
                </td>
                <td className="py-2.5 pr-3 font-mono text-foreground">{s.timesEligible}</td>
                <td className="py-2.5 pr-3 font-mono text-foreground">{s.jobsCompleted}</td>
                <td className="py-2.5 pr-3 font-mono text-foreground">{Math.round(s.winRate * 100)}%</td>
                <td className="py-2.5 pr-3 font-mono text-foreground">${s.avgPrice.toFixed(2)}</td>
                <td className="py-2.5 pr-3 font-mono text-foreground">${s.revenueOpportunity.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
