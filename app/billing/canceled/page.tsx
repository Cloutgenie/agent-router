import Link from "next/link";

export default function BillingCanceledPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center sm:px-6">
      <div className="card p-8">
        <div className="mb-2 text-2xl font-semibold text-foreground">Checkout canceled</div>
        <p className="text-sm text-muted">No changes were made to your plan or payment method.</p>
        <Link
          href="/settings/billing"
          className="mt-5 inline-block rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-raised"
        >
          Back to Billing
        </Link>
      </div>
    </div>
  );
}
