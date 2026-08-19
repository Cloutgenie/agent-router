import { NextRequest } from "next/server";
import { getBillingAccount, setSpendingLimits } from "@/lib/billing/account";
import { dollarsToCents } from "@/lib/billing/pricing";
import { SpendingLimits } from "@/types";

export const dynamic = "force-dynamic";

interface SpendingLimitsBody {
  maxPerTaskDollars?: unknown;
  maxPerDayDollars?: unknown;
  maxPerMonthDollars?: unknown;
}

/** A positive-dollar limit field, or `null` explicitly clears that limit (undefined = leave unset). */
function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return dollarsToCents(raw);
}

export async function GET() {
  const account = await getBillingAccount();
  return Response.json(account.spendingLimits);
}

/** PATCH /api/billing/spending-limits (spec #42) - customer-configurable per-task/day/month hard ceilings, enforced server-side in lib/billing/spendingCheck.ts. */
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as SpendingLimitsBody | null;

  const limits: SpendingLimits = {
    maxPerTaskCents: parseLimit(body?.maxPerTaskDollars),
    maxPerDayCents: parseLimit(body?.maxPerDayDollars),
    maxPerMonthCents: parseLimit(body?.maxPerMonthDollars),
  };

  const account = await setSpendingLimits(limits);
  return Response.json(account.spendingLimits);
}
