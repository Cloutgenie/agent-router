import { CreditAdjustmentForm } from "@/components/CreditAdjustmentForm";
import { StatTileRow } from "@/components/StatTiles";
import { getAdminBillingSummary } from "@/lib/billing/adminSummary";
import { getLedgerForUser } from "@/lib/billing/ledger";

export const dynamic = "force-dynamic";

function centsToDisplay(cents: number | null): string {
  return cents == null ? "Unlimited" : `$${(cents / 100).toFixed(2)}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_STYLES: Record<string, string> = {
  active: "border-good/30 bg-good-soft text-good",
  trialing: "border-accent/30 bg-accent-soft text-accent-strong",
  past_due: "border-warn/30 bg-warn-soft text-warn",
  canceled: "border-bad/30 bg-bad-soft text-bad",
  unpaid: "border-bad/30 bg-bad-soft text-bad",
  inactive: "border-border text-muted-dim",
};

export default async function AdminBillingPage() {
  const summary = await getAdminBillingSummary();
  const ledger = (await getLedgerForUser(summary.account.userId)).reverse();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin: Billing</h1>
        <p className="mt-1 text-sm text-muted">
          Operator view of the (single) billing account - plan status, real revenue/cost/margin for the current
          period, and manual credit adjustments.
        </p>
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[11px] text-warn">
          No access control - this app has no auth system yet, so this page is reachable the same as any other
          route. Do not treat it as protected.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-foreground">{summary.account.plan}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${STATUS_STYLES[summary.status.status] ?? "border-border text-muted-dim"}`}>
          {summary.status.status.replace("_", " ")}
        </span>
        {summary.hasFailedPayment && (
          <span className="rounded-full border border-bad/30 bg-bad-soft px-2 py-0.5 text-[11px] text-bad">payment failed</span>
        )}
        <span className="text-xs text-muted-dim">{summary.billedTaskCount} billed task{summary.billedTaskCount === 1 ? "" : "s"} this period</span>
      </div>

      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-foreground">Execution usage</div>
        <StatTileRow
          tiles={[
            { label: "Included", value: centsToDisplay(summary.status.includedExecutionCents) },
            { label: "Used", value: centsToDisplay(summary.status.usedExecutionCents) },
            { label: "Remaining", value: centsToDisplay(summary.status.remainingExecutionCents) },
            { label: "Overage", value: centsToDisplay(summary.status.overageCents) },
          ]}
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-foreground">Revenue &amp; margin (this period)</div>
        <StatTileRow
          tiles={[
            { label: "Subscription revenue", value: centsToDisplay(summary.subscriptionRevenueCents) },
            { label: "Execution revenue", value: centsToDisplay(summary.executionRevenueCents) },
            { label: "Gross revenue", value: centsToDisplay(summary.grossRevenueCents) },
            { label: "Provider cost", value: centsToDisplay(summary.providerCostCents) },
            { label: "Gross margin", value: centsToDisplay(summary.grossMarginCents) },
          ]}
        />
      </div>

      <div className="mb-6">
        <CreditAdjustmentForm />
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-foreground">Full ledger</div>
        {ledger.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted-dim">No billing activity yet.</div>
        ) : (
          <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Task</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 capitalize text-foreground">{entry.type.replace(/_/g, " ")}</td>
                    <td className={`py-2.5 pr-3 font-mono ${entry.amountCents >= 0 ? "text-good" : "text-foreground"}`}>
                      {entry.amountCents >= 0 ? "+" : ""}
                      {(entry.amountCents / 100).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-dim">{entry.taskId?.startsWith("period-credit:") ? "-" : entry.taskId ?? "-"}</td>
                    <td className="py-2.5 pr-3 text-muted-dim">{typeof entry.metadata?.reason === "string" ? entry.metadata.reason : "-"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-muted-dim">{formatDateTime(entry.createdAt)}</td>
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
