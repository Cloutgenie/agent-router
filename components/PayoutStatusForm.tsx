"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExecutorPayoutStatus } from "@/types";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

const STATUS_OPTIONS: ExecutorPayoutStatus[] = ["not_configured", "pending", "active", "restricted"];

interface ExecutorOption {
  id: string;
  name: string;
}

/**
 * Sets an executor's payout account status (spec #30 readiness). This is a
 * local, simulated status only - no real Stripe Connect account is ever
 * created or contacted, matching the warning banner above it on
 * /admin/payouts.
 */
export function PayoutStatusForm({ executors }: { executors: ExecutorOption[] }) {
  const router = useRouter();
  const [executorId, setExecutorId] = useState(executors[0]?.id ?? "");
  const [payoutStatus, setPayoutStatus] = useState<ExecutorPayoutStatus>("pending");
  const [stripeConnectedAccountId, setStripeConnectedAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executorId, payoutStatus, stripeConnectedAccountId: stripeConnectedAccountId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSuccess(`Set ${executorId} to ${payoutStatus.replace("_", " ")}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update payout status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-1 text-sm font-semibold text-foreground">Set executor payout status</div>
      <p className="mb-3 text-xs text-muted-dim">
        Local status only - no real Stripe Connect account is created or contacted.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Executor</span>
          <select value={executorId} onChange={(e) => setExecutorId(e.target.value)} className={INPUT_CLASS}>
            {executors.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Status</span>
          <select value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value as ExecutorPayoutStatus)} className={INPUT_CLASS}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Stripe connected account ID (optional)</span>
          <input
            type="text"
            value={stripeConnectedAccountId}
            onChange={(e) => setStripeConnectedAccountId(e.target.value)}
            placeholder="acct_..."
            className={INPUT_CLASS}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      {success && <p className="mt-2 text-[12px] text-good">{success}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={saving || !executorId}
        className="mt-3 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : "Update status"}
      </button>
    </div>
  );
}
