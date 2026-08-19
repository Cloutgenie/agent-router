"use client";

import { FollowUpAction } from "@/types";

const ACTIONS: { action: FollowUpAction; label: string }[] = [
  { action: "find-decision-makers", label: "Find decision makers" },
  { action: "enrich-contacts", label: "Enrich contacts" },
  { action: "verify-emails", label: "Verify emails" },
  { action: "deeper-research", label: "Run deeper research" },
];

export function ActionBar({
  selectedCount,
  onFollowUp,
  onExportCsv,
  onExportJson,
  disabled,
}: {
  selectedCount: number;
  onFollowUp: (action: FollowUpAction) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
      <span className="text-xs text-muted">
        {selectedCount > 0 ? `${selectedCount} selected` : "Select rows to act on them"}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        {ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            disabled={disabled || selectedCount === 0}
            onClick={() => onFollowUp(action)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={onExportCsv}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export CSV
        </button>
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={onExportJson}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export JSON
        </button>
      </div>
    </div>
  );
}
