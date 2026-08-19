"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SpendingLimits } from "@/types";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

function centsToDollarsString(cents: number | undefined): string {
  return cents != null ? (cents / 100).toFixed(2) : "";
}

/**
 * Customer-configurable hard spending ceilings (spec #10, #21) - edited
 * here, enforced server-side in lib/billing/spendingCheck.ts on every
 * live-mode task. Mirrors ProvidersTable's KillSwitchPanel pattern: local
 * draft state, PATCH on save, router.refresh() to pull the server-rendered
 * page's fresh state rather than reconciling the response by hand.
 */
export function SpendingLimitsForm({ limits }: { limits: SpendingLimits }) {
  const router = useRouter();
  const [maxPerTask, setMaxPerTask] = useState(centsToDollarsString(limits.maxPerTaskCents));
  const [maxPerDay, setMaxPerDay] = useState(centsToDollarsString(limits.maxPerDayCents));
  const [maxPerMonth, setMaxPerMonth] = useState(centsToDollarsString(limits.maxPerMonthCents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/spending-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxPerTaskDollars: maxPerTask ? Number(maxPerTask) : null,
          maxPerDayDollars: maxPerDay ? Number(maxPerDay) : null,
          maxPerMonthDollars: maxPerMonth ? Number(maxPerMonth) : null,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save spending limits");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-1 text-sm font-semibold text-foreground">Spending limits</div>
      <p className="mb-3 text-xs text-muted-dim">
        Hard ceilings enforced before a live task runs - a task whose estimated cost could exceed one is blocked
        outright, not silently downgraded. Leave blank for no limit.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Max per task</span>
          <input type="number" min={0} step={0.5} value={maxPerTask} onChange={(e) => setMaxPerTask(e.target.value)} placeholder="No limit" className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Max per day</span>
          <input type="number" min={0} step={0.5} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} placeholder="No limit" className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Max per month</span>
          <input type="number" min={0} step={0.5} value={maxPerMonth} onChange={(e) => setMaxPerMonth(e.target.value)} placeholder="No limit" className={INPUT_CLASS} />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-3 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save limits"}
      </button>
    </div>
  );
}
