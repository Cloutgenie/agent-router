import { getAdminBillingSummary } from "@/lib/billing/adminSummary";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/billing/customers (spec #42) - always returns exactly one
 * entry: this app has no user/auth system, so there is exactly one
 * BillingAccount (see lib/billing/account.ts). Shaped as an array anyway,
 * matching the spec's naming, so a future multi-tenant version's route
 * shape wouldn't need to change - only what populates it would.
 */
export async function GET() {
  const summary = await getAdminBillingSummary();
  return Response.json({ customers: [summary] });
}
