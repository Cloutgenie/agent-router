import { getBillingStatusSummary } from "@/lib/billing/status";

export const dynamic = "force-dynamic";

/** Normalized billing state (spec #43) - GET /api/billing/status. */
export async function GET() {
  const summary = await getBillingStatusSummary();
  return Response.json(summary);
}
