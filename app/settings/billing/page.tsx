import { BillingActionButtons } from "@/components/BillingActionButtons";
import { ModeBadge } from "@/components/ModeBadge";
import { SpendingLimitsForm } from "@/components/SpendingLimitsForm";
import { StatTileRow } from "@/components/StatTiles";
import { getBillingAccount } from "@/lib/billing/account";
import { getLedgerForUser } from "@/lib/billing/ledger";
import { planDefinition, PLAN_DEFINITIONS } from "@/lib/billing/plans";
import { getBillingStatusSummary } from "@/lib/billing/status";
import { isStripeConfigured } from "@/lib/billing/stripe/client";
import { BillingPlan } from "@/types";

export const dynamic = "force-dynamic";

function centsToDisplay(cents: number | null): string {
  return cents == null ? "Unlimited" : `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
}

const STATUS_STYLES: Record<string, string> = {
  active: "border-good/30 bg-good-soft text-good",
  trialing: "border-accent/30 bg-accent-soft text-accent-strong",
  past_due: "border-warn/30 bg-warn-soft text-warn",
  canceled: "border-bad/30 bg-bad-soft text-bad",
  unpaid: "border-bad/30 bg-bad-soft text-bad",
  inactive: "border-border text-muted-dim",
};

const PLAN_ORDER: BillingPlan[] = ["free", "starter", "pro", "business", "enterprise"];

export default async function BillingPage() {
  const [account, status] = await Promise.all([getBillingAccount(), getBillingStatusSummary()]);
  const ledger = (await getLedgerForUser(account.userId)).slice(-10).reverse();
  const plan = planDefinition(account.plan);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <ModeBadge />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Billing</h1>
        <p className="mt-1 text-sm text-muted">
          Single-tenant scaffold - one account for this whole app, no sign-in yet. Only live-mode task execution is
          ever billed; Demo Mode is always free.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 card-raised p-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-foreground">{plan.name}</span>
            {!plan.contactSalesOnly && (
              <span className="text-sm text-muted">${(plan.priceCents / 100).toFixed(0)}/month</span>
            )}
            <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${STATUS_STYLES[status.status] ?? "border-border text-muted-dim"}`}>
              {status.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-dim">
            Billing period: {formatDate(status.currentPeriodStart)} - {formatDate(status.currentPeriodEnd)}
          </p>
        </div>
        {isStripeConfigured() ? (
          <BillingActionButtons plan={account.plan} hasStripeCustomer={Boolean(account.stripeCustomerId)} />
        ) : (
          <p className="max-w-xs text-right text-[11px] text-muted-dim">
            Plan changes and payment management require Stripe to be configured (STRIPE_SECRET_KEY) - not set in this
            environment.
          </p>
        )}
      </div>

      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-foreground">Execution usage</div>
        <StatTileRow
          tiles={[
            { label: "Included this month", value: centsToDisplay(status.includedExecutionCents) },
            { label: "Used", value: centsToDisplay(status.usedExecutionCents) },
            { label: "Remaining", value: centsToDisplay(status.remainingExecutionCents) },
            { label: "Current overage", value: centsToDisplay(status.overageCents) },
          ]}
        />
      </div>

      <div className="mb-6">
        <SpendingLimitsForm limits={status.spendingLimits} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="card p-4 sm:p-5">
          <div className="mb-1 text-sm font-semibold text-foreground">Payment method</div>
          <p className="text-xs text-muted-dim">
            {isStripeConfigured()
              ? "Managed entirely in the Stripe billing portal - use \"Manage billing\" above."
              : "Not connected - requires Stripe to be configured (STRIPE_SECRET_KEY)."}
          </p>
        </div>
        <div className="card p-4 sm:p-5">
          <div className="mb-1 text-sm font-semibold text-foreground">Invoices</div>
          <p className="text-xs text-muted-dim">
            Formal invoices are issued through Stripe once connected - use &quot;Manage billing&quot; above, or see
            recent execution charges below in the meantime.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-foreground">Recent ledger activity</div>
        {ledger.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted-dim">No billing activity yet.</div>
        ) : (
          <div className="card overflow-x-auto p-4 scrollbar-thin sm:p-5">
            <table className="w-full min-w-[500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-dim">
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Task</th>
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
                    <td className="whitespace-nowrap py-2.5 pr-3 text-muted-dim">{formatDate(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-foreground">Plans</div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PLAN_ORDER.map((p) => {
            const def = PLAN_DEFINITIONS[p];
            const current = p === account.plan;
            return (
              <div key={p} className={`card p-3.5 ${current ? "border-accent" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{def.name}</span>
                  {current && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] text-accent-strong">current</span>}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {def.contactSalesOnly ? "Contact Sales" : `$${(def.priceCents / 100).toFixed(0)}/mo`}
                </div>
                <div className="mt-1 text-[11px] text-muted-dim">
                  {Number.isFinite(def.entitlements.includedExecutionCents)
                    ? `${centsToDisplay(def.entitlements.includedExecutionCents)} included execution`
                    : "Unlimited execution"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
