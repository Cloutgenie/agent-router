"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ProviderHealth, ProviderHealthState, ProviderOverride, ProviderPerformanceMetrics, ProviderSummary } from "@/types";

const HEALTH_STYLES: Record<ProviderHealthState, string> = {
  healthy: "border-good/30 bg-good-soft text-good",
  degraded: "border-warn/30 bg-warn-soft text-warn",
  unavailable: "border-bad/30 bg-bad-soft text-bad",
  disabled: "border-bad/40 bg-bad-soft text-bad",
  missing_credentials: "border-border text-muted-dim",
};

type OverrideDraft = Partial<
  Pick<ProviderOverride, "enabled" | "degraded" | "maxCostPerTask" | "timeoutMs" | "maxRetries" | "maxConcurrentRuns" | "maxRunsPerTask">
>;

function draftFrom(override: ProviderOverride | undefined): OverrideDraft {
  return {
    enabled: override?.enabled ?? true,
    degraded: override?.degraded ?? false,
    maxCostPerTask: override?.maxCostPerTask,
    timeoutMs: override?.timeoutMs,
    maxRetries: override?.maxRetries,
    maxConcurrentRuns: override?.maxConcurrentRuns,
    maxRunsPerTask: override?.maxRunsPerTask,
  };
}

function KillSwitchPanel({ providerId, override }: { providerId: string; override: ProviderOverride | undefined }) {
  const router = useRouter();
  const [draft, setDraft] = useState<OverrideDraft>(() => draftFrom(override));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/executors/${providerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/executors/${providerId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      setDraft(draftFrom(undefined));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-24 rounded-lg border border-border bg-surface-raised px-2 py-1 text-[12px] text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-dim">Kill switches</div>
      {override && (
        <p className="mb-2 text-[11px] text-muted">
          Currently {override.enabled === false ? "disabled" : override.degraded ? "degraded" : "at defaults"}
          {override.updatedBy === "auto" ? " (set automatically)" : override.enabled === false || override.degraded ? " (set by an operator)" : ""}
          {override.reason ? ` - ${override.reason}` : ""}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={draft.enabled ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-border-strong accent-accent"
          />
          Enabled
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={draft.degraded ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, degraded: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-border-strong accent-accent"
          />
          Degraded
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-dim">
          Max cost ($/task)
          <input
            type="number"
            min={0}
            step={0.1}
            value={draft.maxCostPerTask ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, maxCostPerTask: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="none"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-dim">
          Timeout (ms)
          <input
            type="number"
            min={500}
            step={500}
            value={draft.timeoutMs ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, timeoutMs: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="default"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-dim">
          Retry limit
          <input
            type="number"
            min={1}
            max={5}
            value={draft.maxRetries ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, maxRetries: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="1"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-dim">
          Max concurrent
          <input
            type="number"
            min={1}
            value={draft.maxConcurrentRuns ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, maxConcurrentRuns: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="none"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-dim">
          Max runs/task
          <input
            type="number"
            min={1}
            value={draft.maxRunsPerTask ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, maxRunsPerTask: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="none"
            className={inputClass}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={saving || !override}
            className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
          >
            Reset to default
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-[11px] text-bad">{error}</p>}
    </div>
  );
}

export function ProvidersTable({
  providers,
  health,
  metricsByProvider,
  overridesByProvider,
}: {
  providers: ProviderSummary[];
  health: ProviderHealth[];
  metricsByProvider: Record<string, ProviderPerformanceMetrics[]>;
  overridesByProvider: Record<string, ProviderOverride>;
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
                    <td colSpan={8} className="space-y-3 px-3 py-3">
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
                      <KillSwitchPanel providerId={provider.id} override={overridesByProvider[provider.id]} />
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
