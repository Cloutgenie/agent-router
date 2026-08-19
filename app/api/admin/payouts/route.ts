import { NextRequest } from "next/server";
import { setPayoutAccountStatus } from "@/lib/billing/payoutAccounts";
import { ExecutorPayoutStatus } from "@/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: ExecutorPayoutStatus[] = ["not_configured", "pending", "active", "restricted"];

interface PayoutStatusBody {
  executorId?: unknown;
  payoutStatus?: unknown;
  stripeConnectedAccountId?: unknown;
}

/**
 * POST /api/admin/payouts (spec #30 readiness) - a local, simulated status
 * change only. This never calls any real Stripe Connect API - see the
 * warning banner on /admin/payouts and the comments in
 * lib/billing/payoutAccounts.ts.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as PayoutStatusBody | null;

  const executorId = typeof body?.executorId === "string" ? body.executorId.trim() : "";
  if (!executorId) {
    return Response.json({ error: "executorId is required" }, { status: 400 });
  }

  const payoutStatus = body?.payoutStatus;
  if (typeof payoutStatus !== "string" || !VALID_STATUSES.includes(payoutStatus as ExecutorPayoutStatus)) {
    return Response.json({ error: `payoutStatus must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const stripeConnectedAccountId =
    typeof body?.stripeConnectedAccountId === "string" && body.stripeConnectedAccountId.trim() ? body.stripeConnectedAccountId.trim() : undefined;

  const account = await setPayoutAccountStatus(executorId, payoutStatus as ExecutorPayoutStatus, stripeConnectedAccountId);
  return Response.json({ account });
}
