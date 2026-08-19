"use client";

import { useState } from "react";
import { BillingPlan } from "@/types";

const BUTTON_CLASS =
  "rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50";

/**
 * POSTs to the Checkout/Portal routes and redirects the browser to the
 * Stripe-hosted URL they return - never renders a payment form itself.
 * UNVERIFIED: written against Stripe's documented Checkout/Portal session
 * shape but never run against a real Stripe account - see
 * lib/billing/stripe/client.ts's doc comment.
 */
export function BillingActionButtons({ plan, hasStripeCustomer }: { plan: BillingPlan; hasStripeCustomer: boolean }) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(targetPlan: Exclude<BillingPlan, "free" | "enterprise">) {
    setBusy("checkout");
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? `Checkout failed (${res.status})`);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? `Could not open billing portal (${res.status})`);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        {plan !== "business" && plan !== "enterprise" && (
          <button
            type="button"
            onClick={() => startCheckout(plan === "free" ? "starter" : "business")}
            disabled={busy !== null}
            className={BUTTON_CLASS}
          >
            {busy === "checkout" ? "Redirecting..." : "Upgrade plan"}
          </button>
        )}
        {hasStripeCustomer && (
          <button type="button" onClick={openPortal} disabled={busy !== null} className={BUTTON_CLASS}>
            {busy === "portal" ? "Redirecting..." : "Manage billing"}
          </button>
        )}
      </div>
      {error && <p className="max-w-xs text-right text-[11px] text-bad">{error}</p>}
    </div>
  );
}
