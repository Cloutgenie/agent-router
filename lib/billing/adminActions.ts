import { appendManualLedgerEntry } from "./ledger";
import { ExecutionLedgerEntry } from "@/types";

/**
 * Manual credit adjustments (spec #35) - always requires a reason, so
 * every adjustment to a customer's balance is self-documenting in the
 * ledger itself rather than needing a separate audit trail.
 */
function assertReason(reason: string): void {
  if (!reason.trim()) {
    throw new Error("A reason is required for manual credit adjustments.");
  }
}

export async function grantCredit(userId: string, amountCents: number, reason: string): Promise<ExecutionLedgerEntry> {
  assertReason(reason);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Grant amount must be a positive number of cents.");
  }
  return appendManualLedgerEntry({ userId, type: "credit_adjustment", amountCents, metadata: { reason: reason.trim(), direction: "grant" } });
}

export async function removeCredit(userId: string, amountCents: number, reason: string): Promise<ExecutionLedgerEntry> {
  assertReason(reason);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Removal amount must be a positive number of cents.");
  }
  return appendManualLedgerEntry({ userId, type: "credit_adjustment", amountCents: -amountCents, metadata: { reason: reason.trim(), direction: "remove" } });
}
