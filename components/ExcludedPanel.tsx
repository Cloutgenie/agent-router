"use client";

import { useState } from "react";
import { BuyerRecord } from "@/types";

export function ExcludedPanel({ records }: { records: BuyerRecord[] }) {
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <span className="text-sm font-medium text-foreground">
          {records.length} record{records.length === 1 ? "" : "s"} excluded for low confidence
        </span>
        <span className="text-xs text-muted-dim">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-4">
          {records.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-surface-raised p-3 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{r.company}</span>
                <span className="font-mono text-muted-dim">{Math.round(r.confidence * 100)}% confidence</span>
              </div>
              <ul className="mt-1 space-y-0.5 text-bad">
                {r.verification.issues.slice(0, 3).map((issue, i) => (
                  <li key={i}>- {issue}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
