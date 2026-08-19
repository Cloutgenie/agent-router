import { NextRequest } from "next/server";
import { getStripeClient, isStripeConfigured } from "@/lib/billing/stripe/client";
import { hasProcessedEvent, markEventProcessed } from "@/lib/billing/stripe/eventLog";
import { handleStripeEvent } from "@/lib/billing/stripe/webhookHandlers";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe (spec #13, #41) - mandatory signature
 * verification, idempotent by event id, server-side only. Reads the raw
 * request body (`request.text()`) rather than `request.json()`, since
 * signature verification is over the exact bytes Stripe sent - a
 * re-serialized JSON body would not match the signature even if the
 * content were identical.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Stripe webhooks are not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const rawBody = await request.text();
  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn("Stripe webhook signature verification failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (await hasProcessedEvent(event.id)) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
    await markEventProcessed(event.id);
  } catch (err) {
    // Do not mark as processed - Stripe will retry on a non-2xx response, and we want that retry.
    console.warn(`Stripe webhook handler failed for event ${event.id} (${event.type}):`, err);
    return Response.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return Response.json({ received: true });
}
