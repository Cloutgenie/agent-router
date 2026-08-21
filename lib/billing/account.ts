import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { BillingAccount, BillingPlan, BillingStatus, SpendingLimits } from "@/types";

/**
 * Single-tenant scaffold: this app has no user/auth system yet, so there is
 * exactly one BillingAccount, under one fixed userId. A real multi-user
 * system would replace this constant with an actual signed-in user id -
 * every function here already takes/returns a full BillingAccount rather
 * than assuming global state, so that swap wouldn't require touching the
 * pricing/entitlement/ledger code that calls into this module.
 */
export const DEFAULT_USER_ID = "default-user";

/**
 * Which plan a fresh account starts on. Defaults to "pro" rather than
 * "free" so this app's existing live-testing workflow (real Tavily/Apollo/
 * OpenAI/Browserbase calls, developed across many earlier phases) keeps
 * working without extra setup - there is no Stripe Checkout yet to
 * actually purchase a plan, so this is a local default, not a real
 * subscription. Override with BILLING_DEFAULT_PLAN in .env.
 */
function defaultPlan(): BillingPlan {
  const raw = process.env.BILLING_DEFAULT_PLAN;
  const valid: BillingPlan[] = ["free", "starter", "pro", "business", "enterprise"];
  return valid.includes(raw as BillingPlan) ? (raw as BillingPlan) : "pro";
}

function periodBounds(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function newAccount(): BillingAccount {
  const { start, end } = periodBounds();
  const nowIso = new Date().toISOString();
  return {
    id: `acct-${DEFAULT_USER_ID}`,
    userId: DEFAULT_USER_ID,
    stripeCustomerId: null,
    subscriptionId: null,
    plan: defaultPlan(),
    status: "active" as BillingStatus,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    spendingLimits: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function toAccount(row: Record<string, unknown>): BillingAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    subscriptionId: (row.subscription_id as string | null) ?? null,
    plan: row.plan as BillingPlan,
    status: row.status as BillingStatus,
    currentPeriodStart: row.current_period_start as string,
    currentPeriodEnd: row.current_period_end as string,
    spendingLimits: (row.spending_limits as SpendingLimits) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toRow(account: BillingAccount): Record<string, unknown> {
  return {
    id: account.id,
    user_id: account.userId,
    stripe_customer_id: account.stripeCustomerId,
    subscription_id: account.subscriptionId,
    plan: account.plan,
    status: account.status,
    current_period_start: account.currentPeriodStart,
    current_period_end: account.currentPeriodEnd,
    spending_limits: account.spendingLimits,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

async function readFromDb(): Promise<BillingAccount | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient()
    .from("billing_accounts")
    .select("*")
    .eq("user_id", DEFAULT_USER_ID)
    .maybeSingle();
  if (error) throw error;
  return data ? toAccount(data) : null;
}

/**
 * Without persistence configured, there's nothing to write to - the account
 * getBillingAccount() returns is honestly in-memory-only (a fresh default
 * every call) rather than throwing and blocking every billing page.
 */
async function writeToDb(account: BillingAccount): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabaseClient().from("billing_accounts").upsert(toRow(account));
  if (error) throw error;
}

/** Creates the default account on first call - the single-tenant equivalent of a signup. */
export async function getBillingAccount(): Promise<BillingAccount> {
  const existing = await readFromDb();
  if (existing) return existing;
  const account = newAccount();
  await writeToDb(account);
  return account;
}

export async function updateBillingAccount(patch: Partial<Omit<BillingAccount, "id" | "userId" | "createdAt">>): Promise<BillingAccount> {
  const existing = await getBillingAccount();
  const updated: BillingAccount = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await writeToDb(updated);
  return updated;
}

export async function setSpendingLimits(limits: SpendingLimits): Promise<BillingAccount> {
  return updateBillingAccount({ spendingLimits: limits });
}
