import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ExecutorPayoutAccount, ExecutorPayoutStatus } from "@/types";

/**
 * Stripe Connect readiness (spec #30) - tracks each executor's payout
 * account STATE only. No Stripe Connect account is ever actually created
 * here; `stripeConnectedAccountId` exists as a field to populate once a
 * real onboarding flow exists, and every status change in this file is a
 * local, simulated admin action, not a real Stripe API call - there is no
 * `stripe.accounts.*` usage anywhere in this codebase.
 */

function toAccount(row: Record<string, unknown>): ExecutorPayoutAccount {
  return {
    executorId: row.executor_id as string,
    stripeConnectedAccountId: (row.stripe_connected_account_id as string | null) ?? undefined,
    payoutStatus: row.payout_status as ExecutorPayoutStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function defaultAccount(executorId: string): ExecutorPayoutAccount {
  const nowIso = new Date().toISOString();
  return { executorId, payoutStatus: "not_configured", createdAt: nowIso, updatedAt: nowIso };
}

/** Every executor starts `not_configured` until an admin (simulated) or a future real onboarding flow sets otherwise. */
export async function getPayoutAccount(executorId: string): Promise<ExecutorPayoutAccount> {
  if (!isSupabaseConfigured()) return defaultAccount(executorId);
  const { data, error } = await getSupabaseClient()
    .from("payout_accounts")
    .select("*")
    .eq("executor_id", executorId)
    .maybeSingle();
  if (error) throw error;
  return data ? toAccount(data) : defaultAccount(executorId);
}

export async function getAllPayoutAccounts(): Promise<Record<string, ExecutorPayoutAccount>> {
  if (!isSupabaseConfigured()) return {};
  const { data, error } = await getSupabaseClient().from("payout_accounts").select("*");
  if (error) throw error;
  const all: Record<string, ExecutorPayoutAccount> = {};
  for (const row of data ?? []) all[row.executor_id] = toAccount(row);
  return all;
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
  const existing = await getPayoutAccount(executorId);
  const updated: ExecutorPayoutAccount = {
    ...existing,
    payoutStatus,
    stripeConnectedAccountId: stripeConnectedAccountId ?? existing.stripeConnectedAccountId,
    updatedAt: new Date().toISOString(),
  };
  if (!isSupabaseConfigured()) return updated;
  const { error } = await getSupabaseClient().from("payout_accounts").upsert({
    executor_id: updated.executorId,
    stripe_connected_account_id: updated.stripeConnectedAccountId ?? null,
    payout_status: updated.payoutStatus,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
  });
  if (error) throw error;
  return updated;
}
