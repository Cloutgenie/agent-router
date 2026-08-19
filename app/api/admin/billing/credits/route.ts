import { NextRequest } from "next/server";
import { getBillingAccount } from "@/lib/billing/account";
import { grantCredit, removeCredit } from "@/lib/billing/adminActions";
import { dollarsToCents } from "@/lib/billing/pricing";

export const dynamic = "force-dynamic";

interface CreditBody {
  direction?: unknown;
  amountDollars?: unknown;
  reason?: unknown;
}

/** POST /api/admin/billing/credits (spec #35, #42) - manual grant/remove, always requiring a reason. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CreditBody | null;

  const direction = body?.direction;
  if (direction !== "grant" && direction !== "remove") {
    return Response.json({ error: 'direction must be "grant" or "remove"' }, { status: 400 });
  }

  const amountDollars = body?.amountDollars;
  if (typeof amountDollars !== "number" || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    return Response.json({ error: "amountDollars must be a positive number" }, { status: 400 });
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return Response.json({ error: "reason is required for a manual credit adjustment" }, { status: 400 });
  }

  const account = await getBillingAccount();
  const amountCents = dollarsToCents(amountDollars);

  try {
    const entry = direction === "grant" ? await grantCredit(account.userId, amountCents, reason) : await removeCredit(account.userId, amountCents, reason);
    return Response.json({ entry });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Credit adjustment failed" }, { status: 400 });
  }
}
