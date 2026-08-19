import { PayoutStatusForm } from "@/components/PayoutStatusForm";
import { getBillingAccount } from "@/lib/billing/account";
import { getAllPayoutAccounts } from "@/lib/billing/payoutAccounts";
import { aggregateSettlements } from "@/lib/billing/settlement";
import { getAllHistoryTasks } from "@/lib/history/store";
import { getAllProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const PAYOUT_STATUS_STYLES: Record<string, string> = {
  active: "border-good/30 bg-good-soft text-good",
  pending: "border-accent/30 bg-accent-soft text-accent-strong",
  restricted: "border-bad/30 bg-bad-soft text-bad",
  not_configured: "border-border text-muted-dim",
};

export default async function AdminPayoutsPage() {
  const providers = getAllProviders();
  const [account, payoutAccounts, tasks] = await Promise.all([getBillingAccount(), getAllPayoutAccounts(), getAllHistoryTasks()]);

  const periodStart = account.currentPeriodStart ?? new Date(0).toISOString();
  const periodEnd = account.currentPeriodEnd ?? new Date().toISOString();
  const billedTasks = tasks.filter((t) => t.economics && t.created_at >= periodStart && t.created_at <= periodEnd);
  const settlementTotals = aggregateSettlements(billedTasks);

  const executors = providers.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin: Executor Payouts</h1>
        <p className="mt-1 text-sm text-muted">
          Stripe Connect readiness (billing spec #30-31, #62) - data models and settlement previews only. No payout
          is ever executed and no real Stripe Connect account is ever created anywhere in this codebase.
        </p>
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[11px] text-warn">
          No access control - this app has no auth system yet, so this page is reachable the same as any other
          route. Do not treat it as protected. Every figure below is illustrative: no money moves and no Stripe
          Connect API is ever called.
        </p>
      </div>

      <div className="mb-6">
        <PayoutStatusForm executors={executors} />
      </div>

      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-foreground">Payout accounts</div>
        <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
                <th className="py-2 pr-3 font-medium">Executor</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Stripe connected account</th>
                <th className="py-2 pr-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {executors.map((executor) => {
                const record = payoutAccounts[executor.id];
                const status = record?.payoutStatus ?? "not_configured";
                return (
                  <tr key={executor.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 text-foreground">{executor.name}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${PAYOUT_STATUS_STYLES[status]}`}>
                        {status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-muted-dim">{record?.stripeConnectedAccountId ?? "-"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-muted-dim">
                      {record ? new Date(record.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-foreground">Settlement preview (this period, illustrative)</div>
        {settlementTotals.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted-dim">No billed executions this period yet.</div>
        ) : (
          <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
            <table className="w-full min-w-[500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
                  <th className="py-2 pr-3 font-medium">Executor</th>
                  <th className="py-2 pr-3 font-medium">Tasks</th>
                  <th className="py-2 pr-3 font-medium">Would-be payout</th>
                </tr>
              </thead>
              <tbody>
                {settlementTotals.map((row) => (
                  <tr key={row.executorId} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 text-foreground">{row.executorName}</td>
                    <td className="py-2.5 pr-3 text-muted-dim">{row.taskCount}</td>
                    <td className="py-2.5 pr-3 font-mono text-foreground">{centsToDisplay(row.totalPayoutCents)}</td>
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
