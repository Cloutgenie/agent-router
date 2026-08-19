import fs from "node:fs/promises";
import path from "node:path";
import { BillingAccount, BillingPlan, BillingStatus, SpendingLimits } from "@/types";

const ACCOUNT_PATH = path.join(process.cwd(), "data", "billing-account.json");

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

async function readFromDisk(): Promise<BillingAccount | null> {
  try {
    const raw = await fs.readFile(ACCOUNT_PATH, "utf-8");
    return JSON.parse(raw) as BillingAccount;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeToDisk(account: BillingAccount): Promise<void> {
  await fs.writeFile(ACCOUNT_PATH, JSON.stringify(account, null, 2), "utf-8");
}

/** Creates the default account on first call - the single-tenant equivalent of a signup. */
export async function getBillingAccount(): Promise<BillingAccount> {
  const existing = await readFromDisk();
  if (existing) return existing;
  const account = newAccount();
  await writeToDisk(account);
  return account;
}

export async function updateBillingAccount(patch: Partial<Omit<BillingAccount, "id" | "userId" | "createdAt">>): Promise<BillingAccount> {
  const existing = await getBillingAccount();
  const updated: BillingAccount = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await writeToDisk(updated);
  return updated;
}

export async function setSpendingLimits(limits: SpendingLimits): Promise<BillingAccount> {
  return updateBillingAccount({ spendingLimits: limits });
}
