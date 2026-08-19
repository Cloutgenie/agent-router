import Link from "next/link";

/**
 * Landing page after a Stripe Checkout redirect (spec #11). Deliberately
 * shows no plan/payment details itself - the redirect alone is never proof
 * of payment (spec #11's own instruction); the real, webhook-synced state
 * lives on /settings/billing, which this links to.
 */
export default function BillingSuccessPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center sm:px-6">
      <div className="card-raised p-8">
        <div className="mb-2 text-2xl font-semibold text-foreground">Payment received</div>
        <p className="text-sm text-muted">
          Your subscription is being activated. This usually takes a few seconds - refresh your billing page if it
          isn&apos;t showing yet.
        </p>
        <Link
          href="/settings/billing"
          className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong"
        >
          Go to Billing
        </Link>
      </div>
    </div>
  );
}
