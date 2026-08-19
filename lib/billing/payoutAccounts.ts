import fs from "node:fs/promises";
import path from "node:path";
import { ExecutorPayoutAccount, ExecutorPayoutStatus } from "@/types";

const PAYOUT_ACCOUNTS_PATH = path.join(process.cwd(), "data", "executor-payout-accounts.json");

/**
 * Stripe Connect readiness (spec #30) - tracks each executor's payout
 * account STATE only. No Stripe Connect account is ever actually created
 * here; `stripeConnectedAccountId` exists as a field to populate once a
 * real onboarding flow exists, and every status change in this file is a
 * local, simulated admin action, not a real Stripe API call - there is no
 * `stripe.accounts.*` usage anywhere in this codebase.
 */

async function readAll(): Promise<Record<string, ExecutorPayoutAccount>> {
  try {
    const raw = await fs.readFile(PAYOUT_ACCOUNTS_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, ExecutorPayoutAccount>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeAll(accounts: Record<string, ExecutorPayoutAccount>): Promise<void> {
  await fs.writeFile(PAYOUT_ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), "utf-8");
}

function defaultAccount(executorId: string): ExecutorPayoutAccount {
  const nowIso = new Date().toISOString();
  return { executorId, payoutStatus: "not_configured", createdAt: nowIso, updatedAt: nowIso };
}

/** Every executor starts `not_configured` until an admin (simulated) or a future real onboarding flow sets otherwise. */
export async function getPayoutAccount(executorId: string): Promise<ExecutorPayoutAccount> {
  const all = await readAll();
  return all[executorId] ?? defaultAccount(executorId);
}

export async function getAllPayoutAccounts(): Promise<Record<string, ExecutorPayoutAccount>> {
  return readAll();
}

/**
 * Local, simulated status change (spec #30's `payoutStatus` field) - not a
 * real Stripe Connect onboarding step. `stripeConnectedAccountId`, when
 * provided, is stored verbatim but never verified against a real Stripe
 * account, since none is ever created.
 */
export async function setPayoutAccountStatus(
  executorId: string,
  payoutStatus: ExecutorPayoutStatus,
  stripeConnectedAccountId?: string
): Promise<ExecutorPayoutAccount> {
  const all = await readAll();
  const existing = all[executorId] ?? defaultAccount(executorId);
  const updated: ExecutorPayoutAccount = {
    ...existing,
    payoutStatus,
    stripeConnectedAccountId: stripeConnectedAccountId ?? existing.stripeConnectedAccountId,
    updatedAt: new Date().toISOString(),
  };
  all[executorId] = updated;
  await writeAll(all);
  return updated;
}
