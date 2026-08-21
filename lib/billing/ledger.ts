import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ExecutionLedgerEntry, LedgerEntryType } from "@/types";

let idCounter = 0;

interface AppendInput {
  userId: string;
  taskId?: string;
  type: LedgerEntryType;
  amountCents: number;
  metadata?: Record<string, unknown>;
}

function toEntry(row: Record<string, unknown>): ExecutionLedgerEntry {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    taskId: (row.task_id as string | undefined) ?? undefined,
    type: row.type as LedgerEntryType,
    amountCents: row.amount_cents as number,
    createdAt: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown> | undefined) ?? undefined,
  };
}

async function append(input: AppendInput): Promise<ExecutionLedgerEntry> {
  const entry: ExecutionLedgerEntry = {
    id: `ledger-${Date.now()}-${idCounter++}`,
    userId: input.userId,
    taskId: input.taskId,
    type: input.type,
    amountCents: input.amountCents,
    createdAt: new Date().toISOString(),
    metadata: input.metadata,
  };

  // Without persistence configured, a live-mode task still gets a coherent
  // in-memory receipt for this one request rather than a hard crash - it
  // just won't be there on the next request (billing genuinely needs real
  // persistence to mean anything; this is a graceful demo fallback, not a
  // substitute for configuring Supabase before actually relying on billing).
  if (!isSupabaseConfigured()) return entry;

  const { error } = await getSupabaseClient().from("execution_ledger").insert({
    id: entry.id,
    user_id: entry.userId,
    task_id: entry.taskId ?? null,
    type: entry.type,
    amount_cents: entry.amountCents,
    metadata: entry.metadata ?? null,
    created_at: entry.createdAt,
  });
  if (error) throw error;
  return entry;
}

/**
 * Idempotent by billing key (spec #17, #45): re-calling with the same
 * `taskId`+`type` returns the existing entry instead of writing a second
 * one - a retried request, a duplicate webhook delivery, or a re-run of
 * task finalization must never double-charge or double-credit.
 */
export async function appendLedgerEntry(input: AppendInput & { idempotencyKey?: string }): Promise<ExecutionLedgerEntry> {
  if (input.taskId && isSupabaseConfigured()) {
    const { data, error } = await getSupabaseClient()
      .from("execution_ledger")
      .select("*")
      .eq("task_id", input.taskId)
      .eq("type", input.type)
      .maybeSingle();
    if (error) throw error;
    if (data) return toEntry(data);
  }
  return append(input);
}

/**
 * For manual admin actions (spec #35: grant/remove credit) - always writes
 * a fresh entry, unlike `appendLedgerEntry`. There is no natural
 * idempotency key for a deliberate, one-off admin action the way there is
 * for a task's own billing finalization; each call is a distinct decision,
 * not a retry to dedupe.
 */
export async function appendManualLedgerEntry(input: AppendInput): Promise<ExecutionLedgerEntry> {
  return append(input);
}

export async function getLedgerForUser(userId: string): Promise<ExecutionLedgerEntry[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient()
    .from("execution_ledger")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEntry);
}

/** Sum of every entry's `amountCents` for a user - the balance, computed from the ledger itself, never a cached counter that can drift. */
export async function getLedgerBalanceCents(userId: string): Promise<number> {
  const entries = await getLedgerForUser(userId);
  return entries.reduce((sum, e) => sum + e.amountCents, 0);
}

/** Charges (negative amountCents from execution_charge entries) within an inclusive ISO date window - the basis for daily/monthly spending-limit checks. */
export async function getChargesInWindow(userId: string, startIso: string, endIso: string): Promise<number> {
  const entries = await getLedgerForUser(userId);
  return entries
    .filter((e) => e.type === "execution_charge" && e.createdAt >= startIso && e.createdAt <= endIso)
    .reduce((sum, e) => sum + Math.abs(e.amountCents), 0);
}

/** Signed sum of manual credit_adjustment entries (spec #35's grant/remove) within an inclusive ISO date window - a grant/removal within the current period changes the customer's effective included balance, not just the raw ledger total. */
export async function getAdjustmentsInWindow(userId: string, startIso: string, endIso: string): Promise<number> {
  const entries = await getLedgerForUser(userId);
  return entries
    .filter((e) => e.type === "credit_adjustment" && e.createdAt >= startIso && e.createdAt <= endIso)
    .reduce((sum, e) => sum + e.amountCents, 0);
}
