"use client";

import { useState } from "react";
import { actualProviderName } from "@/lib/providerLabel";
import { ExecutionStep, StepStatus, TrustTier } from "@/types";

/** "trusted" is the normal, unremarkable state - no badge needed for it. */
const TRUST_TIER_BADGE: Partial<Record<TrustTier, string>> = {
  new: "border-muted-dim/30 bg-surface-raised text-muted-dim",
  probation: "border-warn/30 bg-warn-soft text-warn",
  degraded: "border-bad/30 bg-bad-soft text-bad",
  suspended: "border-bad/30 bg-bad-soft text-bad",
};

const STATUS_STYLES: Record<StepStatus, string> = {
  pending: "border-border text-muted-dim",
  running: "border-accent/40 bg-accent-soft text-accent-strong",
  completed: "border-good/30 bg-good-soft text-good",
  failed: "border-bad/30 bg-bad-soft text-bad",
  awaiting_approval: "border-warn/40 bg-warn-soft text-warn",
};

const STATUS_LABELS: Record<StepStatus, string> = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
  awaiting_approval: "awaiting approval",
};

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-10 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-[11px] text-muted">{value.toFixed(2)}</span>
    </div>
  );
}

function RoutingBreakdown({ step }: { step: ExecutionStep }) {
  if (step.candidates.length === 0) {
    return <p className="p-3 text-[12px] text-muted-dim">No eligible providers were scored for this step.</p>;
  }

  return (
    <div className="overflow-x-auto scrollbar-thin p-3">
      <table className="w-full min-w-[600px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-dim">
            <th className="py-1.5 pr-3 font-medium">Provider</th>
            <th className="py-1.5 pr-3 font-medium">Fit</th>
            <th className="py-1.5 pr-3 font-medium">Quality</th>
            <th className="py-1.5 pr-3 font-medium">Cost eff.</th>
            <th className="py-1.5 pr-3 font-medium">Latency</th>
            <th className="py-1.5 pr-3 font-medium">History</th>
            <th className="py-1.5 pr-3 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {step.candidates.map((c) => (
            <tr key={c.provider_id} className={`border-b border-border/60 ${c.selected ? "bg-accent-soft" : ""}`}>
              <td className="py-1.5 pr-3">
                <div className="flex items-center gap-1.5">
                  {c.selected && <span className="h-1.5 w-1.5 rounded-full bg-accent-strong" />}
                  <span className="font-medium text-foreground">{c.provider_name}</span>
                  {TRUST_TIER_BADGE[c.trust_tier] && (
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] capitalize ${TRUST_TIER_BADGE[c.trust_tier]}`}>
                      {c.trust_tier}
                    </span>
                  )}
                  {c.explored && (
                    <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn">explored</span>
                  )}
                  {!c.within_budget && <span className="text-[10px] text-bad">over budget</span>}
                  {!c.configured && <span className="text-[10px] text-muted-dim">not configured</span>}
                </div>
              </td>
              <td className="py-1.5 pr-3"><ScoreBar value={c.capability_fit} /></td>
              <td className="py-1.5 pr-3"><ScoreBar value={c.quality_score} /></td>
              <td className="py-1.5 pr-3"><ScoreBar value={c.cost_efficiency} /></td>
              <td className="py-1.5 pr-3"><ScoreBar value={c.latency_score} /></td>
              <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">
                {c.historical_bonus > 0 ? "+" : ""}
                {c.historical_bonus.toFixed(2)}
              </td>
              <td className="py-1.5 pr-3">
                <span className={`font-mono text-[13px] font-semibold ${c.selected ? "text-accent-strong" : "text-foreground"}`}>
                  {c.total_score.toFixed(2)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepCard({ step }: { step: ExecutionStep }) {
  const [open, setOpen] = useState(false);
  const ranVia = actualProviderName(step);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{step.description}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[step.status]}`}>
              {step.status === "running" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent-strong" />}
              {STATUS_LABELS[step.status]}
            </span>
            {step.usedFallback && (
              <span className="rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[10px] text-warn">
                fallback used
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-dim">
            <span>{step.capability.replace(/-/g, " ")}</span>
            {step.dependencies.length > 0 && <span>after: {step.dependencies.join(", ")}</span>}
            {ranVia && <span>via {ranVia}</span>}
          </div>
          {step.status === "awaiting_approval" && step.approval?.reason && (
            <p className="mt-1 text-[11px] text-warn">{step.approval.reason}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted transition hover:bg-surface-raised hover:text-foreground"
        >
          {open ? "Hide" : "How this was routed"}
        </button>
      </div>
      {open && (
        <div className="border-t border-border">
          <RoutingBreakdown step={step} />
        </div>
      )}
    </div>
  );
}

export function PlanGraph({ steps }: { steps: ExecutionStep[] }) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <StepCard key={step.id} step={step} />
      ))}
    </div>
  );
}
