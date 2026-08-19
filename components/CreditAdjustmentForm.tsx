"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

/** Manual credit grant/removal (spec #35) - a reason is mandatory, enforced both here and server-side in lib/billing/adminActions.ts. */
export function CreditAdjustmentForm() {
  const router = useRouter();
  const [direction, setDirection] = useState<"grant" | "remove">("grant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/billing/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amountDollars: Number(amount), reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSuccess(`${direction === "grant" ? "Granted" : "Removed"} $${Number(amount).toFixed(2)}.`);
      setAmount("");
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the adjustment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-1 text-sm font-semibold text-foreground">Grant / remove credit</div>
      <p className="mb-3 text-xs text-muted-dim">Every manual adjustment requires a reason - it&apos;s written into the ledger entry itself.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Action</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as "grant" | "remove")} className={INPUT_CLASS}>
            <option value="grant">Grant credit</option>
            <option value="remove">Remove credit</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Amount ($)</span>
          <input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-dim">Reason (required)</span>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. service credit for outage on Aug 12" className={INPUT_CLASS} />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      {success && <p className="mt-2 text-[12px] text-good">{success}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={saving || !amount || !reason.trim()}
        className="mt-3 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Applying..." : "Apply adjustment"}
      </button>
    </div>
  );
}
