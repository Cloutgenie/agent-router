import { getBillingAccount } from "@/lib/billing/account";
import { getLedgerForUser } from "@/lib/billing/ledger";

export const dynamic = "force-dynamic";

/** Full ledger history for the (single-tenant) account, most recent first. */
export async function GET() {
  const account = await getBillingAccount();
  const entries = await getLedgerForUser(account.userId);
  return Response.json({ entries: [...entries].reverse() });
}
