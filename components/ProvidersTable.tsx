"use client";

import { Fragment, useState } from "react";
import { ProviderHealth, ProviderHealthState, ProviderPerformanceMetrics, ProviderSummary } from "@/types";

const HEALTH_STYLES: Record<ProviderHealthState, string> = {
  healthy: "border-good/30 bg-good-soft text-good",
  degraded: "border-warn/30 bg-warn-soft text-warn",
  unavailable: "border-bad/30 bg-bad-soft text-bad",
  missing_credentials: "border-border text-muted-dim",
};

export function ProvidersTable({
  providers,
  health,
  metricsByProvider,
}: {
  providers: ProviderSummary[];
  health: ProviderHealth[];
  metricsByProvider: Record<string, ProviderPerformanceMetrics[]>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const healthById = new Map(health.map((h) => [h.provider_id, h]));

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
            <th className="py-2 pr-3 font-medium">Provider</th>
            <th className="py-2 pr-3 font-medium">Capabilities</th>
            <th className="py-2 pr-3 font-medium">Health</th>
            <th className="py-2 pr-3 font-medium">Jobs</th>
            <th className="py-2 pr-3 font-medium">Success</th>
            <th className="py-2 pr-3 font-medium">Verification</th>
            <th className="py-2 pr-3 font-medium">Cost</th>
            <th className="py-2 pr-3 font-medium">Latency</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((provider) => {
            const metrics = metricsByProvider[provider.id] ?? [];
            const jobs = metrics.reduce((sum, m) => sum + m.tasks_attempted, 0);
            const avgSuccess = weightedAvg(metrics.map((m) => [m.success_rate, m.tasks_attempted]));
            const avgVerification = weightedAvg(metrics.map((m) => [m.verification_pass_rate, m.tasks_attempted]));
            const h = healthById.get(provider.id);
            const isOpen = expanded === provider.id;

            return (
              <Fragment key={provider.id}>
                <tr
                  className="cursor-pointer border-b border-border/60 align-top transition hover:bg-surface-raised"
                  onClick={() => setExpanded(isOpen ? null : provider.id)}
                >
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-foreground">{provider.name}</div>
                    <div className="text-[11px] text-muted-dim">
                      {provider.protocol} · ${provider.price_per_task.toFixed(2)}/task
                    </div>
                  </td>
                  <td className="max-w-[260px] py-2.5 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {provider.capabilities.map((c) => (
                        <span key={c} className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-strong">
                          {c.replace(/-/g, " ")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] capitalize ${h ? HEALTH_STYLES[h.state] : ""}`}>
                      {h?.state.replace(/_/g, " ") ?? "unknown"}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{jobs}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{jobs > 0 ? `${Math.round(avgSuccess * 100)}%` : "-"}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{jobs > 0 ? `${Math.round(avgVerification * 100)}%` : "-"}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">${provider.price_per_task.toFixed(2)}</td>
                  <td className="py-2.5 pr-3 font-mono text-foreground">{provider.average_latency_seconds}s</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/60 bg-surface-raised/50">
                    <td colSpan={8} className="px-3 py-3">
                      {metrics.length === 0 ? (
                        <p className="text-[12px] text-muted-dim">No tasks routed to this provider yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {metrics.map((m) => (
                            <div key={m.capability} className="flex items-center justify-between text-[12px]">
                              <span className="text-muted">{m.capability.replace(/-/g, " ")}</span>
                              <span className="font-mono text-foreground">
                                {Math.round(m.success_rate * 100)}% success · {Math.round(m.verification_pass_rate * 100)}% verified ·{" "}
                                {m.tasks_attempted} jobs
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function weightedAvg(pairs: [number, number][]): number {
  const totalWeight = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return 0;
  return pairs.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight;
}
