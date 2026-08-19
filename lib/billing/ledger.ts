import fs from "node:fs/promises";
import path from "node:path";
import { ExecutionLedgerEntry, LedgerEntryType } from "@/types";

const LEDGER_PATH = path.join(process.cwd(), "data", "execution-ledger.json");

async function readAll(): Promise<ExecutionLedgerEntry[]> {
  try {
    const raw = await fs.readFile(LEDGER_PATH, "utf-8");
    return JSON.parse(raw) as ExecutionLedgerEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(entries: ExecutionLedgerEntry[]): Promise<void> {
  await fs.writeFile(LEDGER_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Same serialized read-modify-write queue as performanceStore.ts/
 * quoteStore.ts - ledger writes must never interleave and clobber each
 * other, and this is the one store where that would mean losing a real
 * financial record, not just a stale metric.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
let idCounter = 0;

interface AppendInput {
  userId: string;
  taskId?: string;
  type: LedgerEntryType;
  amountCents: number;
  metadata?: Record<string, unknown>;
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

  const result = writeQueue.then(async () => {
    const all = await readAll();
    all.push(entry);
    await writeAll(all);
    return entry;
  });
  writeQueue = result.catch(() => undefined);
  return result;
}

/**
 * Idempotent by billing key (spec #17, #45): re-calling with the same
 * `taskId`+`type` returns the existing entry instead of writing a second
 * one - a retried request, a duplicate webhook delivery, or a re-run of
 * task finalization must never double-charge or double-credit.
 */
export async function appendLedgerEntry(input: AppendInput & { idempotencyKey?: string }): Promise<ExecutionLedgerEntry> {
  if (input.taskId) {
    const all = await readAll();
    const existing = all.find((e) => e.taskId === input.taskId && e.type === input.type);
    if (existing) return existing;
  }
  return append(input);
}

export async function getLedgerForUser(userId: string): Promise<ExecutionLedgerEntry[]> {
  const all = await readAll();
  return all.filter((e) => e.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
